import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const control = `http://127.0.0.1:${process.env.E2E_CONTROL_PORT || 18788}`;
test.use({ extraHTTPHeaders: { 'oai-authenticated-user-id': 'runtime-owner', 'oai-authenticated-user-email': 'owner@example.test' } });
test.beforeEach(async ({ request }) => {
  const response = await request.post(`${control}/reset`);
  expect(response.ok(), await response.text()).toBeTruthy();
});

test('dashboard → course → back and subtitle download', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'View Runtime Course curriculum' }).click();
  await expect(page).toHaveURL(/\/courses\/1$/);
  await expect(page.getByRole('heading', { name: 'Runtime Course' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '1. Runtime Lecture' })).toBeVisible();
  // Download through the authenticated application endpoint in the browser.
  const downloading = page.waitForEvent('download');
  await page.goto('/api/subtitles/1/content').catch(error => {
    if (!String(error).includes('Download is starting')) throw error;
  });
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('subtitle-1.vtt');
  expect(await readFile((await download.path())!, 'utf8')).toContain('Runtime caption');
  await page.goto('/courses/1');
  await page.getByRole('link', { name: 'Courses', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Runtime Course' })).toBeVisible();
});

test('real import survives browser closure, Worker restart and Udemy reconnection', async ({ page, context, request }) => {
  await expect(await request.post(`${control}/workflow`)).toBeOK();
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Import Course/ }).first().click();
  await page.getByPlaceholder(/udemy.com/).fill('https://www.udemy.com/course/browser-import/');
  await page.getByRole('button', { name: 'Import & Download Subtitles' }).click();
  await expect.poll(async () => (await (await request.get(`${control}/state`)).json())?.id).toBeTruthy();
  await page.close();
  await expect.poll(async () => {
    await request.post(`${control}/dispatch`);
    return (await (await request.get(`${control}/state`)).json())?.status;
  }, { timeout: 30000 }).toBe('WAITING_SESSION');
  const before = await (await request.get(`${control}/state`)).json();
  expect(before.job_type).toBe('SUBTITLE_BATCH');
  await expect(await request.post(`${control}/restart`)).toBeOK();
  const after = await (await request.get(`${control}/state`)).json();
  expect(after.payload_json).toBe(before.payload_json);
  await expect(await request.post(`${control}/reconnect`)).toBeOK();
  await expect.poll(async () => {
    await request.post(`${control}/dispatch`);
    return (await (await request.get(`${control}/state`)).json()).status;
  }, { timeout: 30000 }).toBe('COMPLETED');
  const reopened = await context.newPage();
  await reopened.goto('/dashboard');
  await expect(reopened.getByRole('heading', { name: 'Imported Course', exact: true })).toBeVisible();
  expect((await (await request.get(`${control}/counters`)).json()).downloads).toBe(1);
  const subtitle = await (await request.get(`${control}/subtitle-state`)).json();
  await expect(await request.post(`${control}/drive-failure`)).toBeOK();
  const queueDrive = () => request.post(`/api/subtitles/lectures/${subtitle.lecture_id}/process`);
  await expect(await queueDrive()).toBeOK();
  await expect.poll(async () => {
    await request.post(`${control}/dispatch`);
    return (await (await request.get(`${control}/subtitle-state`)).json()).drive_status;
  }, { timeout: 30000 }).toBe('FAILED');
  await reopened.close();
  await expect(await request.post(`${control}/restart`)).toBeOK();
  await expect(await request.post(`${control}/drive-recovered`)).toBeOK();
  const job = await (await request.get(`${control}/state`)).json();
  // Explicit retry resets the durable retry delay through the application API.
  // Cancel first because transient failures remain eligible for automatic retry.
  await expect(await request.post(`/api/jobs/${job.id}/cancel`)).toBeOK();
  await expect(await request.post(`/api/jobs/${job.id}/retry`)).toBeOK();
  await expect.poll(async () => {
    await request.post(`${control}/dispatch`);
    return (await (await request.get(`${control}/subtitle-state`)).json()).drive_status;
  }, { timeout: 30000 }).toBe('COMPLETED');
  const counters = await (await request.get(`${control}/counters`)).json();
  expect(counters.downloads).toBe(1);
  expect(counters.uploads).toBe(1);
});

test('import shows progress, retries a failure, and cancels the job', async ({ page, request }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Import Course/ }).first().click();
  await page.getByPlaceholder(/udemy.com/).fill('https://www.udemy.com/course/browser-import/');
  await page.getByRole('button', { name: 'Import & Download Subtitles' }).click();
  await expect(page.getByText('Importing Course Curriculum', { exact: true })).toBeVisible();
  await expect(await request.post(`${control}/progress`)).toBeOK();
  await expect(page.getByText('Reading curriculum page 2', { exact: true })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('40%', { exact: true })).toBeVisible();
  await expect(page.getByText('Items: 4 / 10', { exact: true })).toBeVisible();
  await expect(await request.post(`${control}/fail`)).toBeOK();
  await expect(page.getByRole('alert')).toHaveText('Fixture network interruption', { timeout: 10000 });
  await page.getByRole('button', { name: 'Retry job' }).click();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  await expect.poll(async () => (await (await request.get(`${control}/state`)).json()).status).toBe('PENDING');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(async () => (await (await request.get(`${control}/state`)).json()).status).toBe('CANCELLED');
  await expect(page.getByText('Importing Course Curriculum', { exact: true })).toHaveCount(0);
});
