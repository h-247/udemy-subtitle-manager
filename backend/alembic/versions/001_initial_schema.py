"""001_initial_schema

Revision ID: 001_initial_schema
Revises:
Create Date: 2026-10-12 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = '001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. users
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('hashed_password', sa.String(length=255), nullable=False),
        sa.Column('drive_credentials', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('1')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_id'), 'users', ['id'], unique=False)

    # 2. udemy_sessions
    op.create_table(
        'udemy_sessions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('encrypted_cookie_data', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='DISCONNECTED'),
        sa.Column('account_name', sa.String(length=256), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('last_validated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', name='uq_session_user')
    )
    op.create_index(op.f('ix_udemy_sessions_id'), 'udemy_sessions', ['id'], unique=False)
    op.create_index(op.f('ix_udemy_sessions_status'), 'udemy_sessions', ['status'], unique=False)
    op.create_index(op.f('ix_udemy_sessions_user_id'), 'udemy_sessions', ['user_id'], unique=True)

    # 3. courses
    op.create_table(
        'courses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=512), nullable=False),
        sa.Column('url', sa.String(length=512), nullable=False),
        sa.Column('instructor', sa.String(length=256), nullable=True),
        sa.Column('thumbnail_url', sa.String(length=1024), nullable=True),
        sa.Column('last_synced_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'course_id', name='uq_user_course')
    )
    op.create_index(op.f('ix_courses_course_id'), 'courses', ['course_id'], unique=False)
    op.create_index(op.f('ix_courses_id'), 'courses', ['id'], unique=False)
    op.create_index(op.f('ix_courses_user_id'), 'courses', ['user_id'], unique=False)

    # 4. sections
    op.create_table(
        'sections',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=512), nullable=False),
        sa.Column('position', sa.Integer(), nullable=False, server_default='1'),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_sections_course_id'), 'sections', ['course_id'], unique=False)
    op.create_index(op.f('ix_sections_id'), 'sections', ['id'], unique=False)

    # 5. lectures
    op.create_table(
        'lectures',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('section_id', sa.Integer(), nullable=False),
        sa.Column('lecture_id', sa.String(length=64), nullable=False),
        sa.Column('title', sa.String(length=512), nullable=False),
        sa.Column('url', sa.String(length=512), nullable=False),
        sa.Column('lecture_type', sa.String(length=32), nullable=False, server_default='video'),
        sa.Column('duration', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('position', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('learning_status', sa.String(length=32), nullable=False, server_default='NOT_STARTED'),
        sa.Column('chatgpt_url', sa.String(length=1024), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['section_id'], ['sections.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_lectures_id'), 'lectures', ['id'], unique=False)
    op.create_index(op.f('ix_lectures_lecture_id'), 'lectures', ['lecture_id'], unique=False)
    op.create_index(op.f('ix_lectures_section_id'), 'lectures', ['section_id'], unique=False)
    op.create_index(op.f('ix_lectures_learning_status'), 'lectures', ['learning_status'], unique=False)

    # 6. subtitles
    op.create_table(
        'subtitles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('lecture_id', sa.Integer(), nullable=False),
        sa.Column('language', sa.String(length=32), nullable=False, server_default='en'),
        sa.Column('subtitle_type', sa.String(length=32), nullable=False, server_default='NONE'),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='PENDING'),
        sa.Column('drive_file_id', sa.String(length=256), nullable=True),
        sa.Column('drive_file_url', sa.String(length=1024), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('error_category', sa.String(length=64), nullable=True),
        sa.Column('last_processed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['lecture_id'], ['lectures.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('lecture_id', 'language', name='uq_lecture_language')
    )
    op.create_index(op.f('ix_subtitles_id'), 'subtitles', ['id'], unique=False)
    op.create_index(op.f('ix_subtitles_lecture_id'), 'subtitles', ['lecture_id'], unique=False)
    op.create_index(op.f('ix_subtitles_status'), 'subtitles', ['status'], unique=False)

    # 7. processing_jobs
    op.create_table(
        'processing_jobs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('course_id', sa.Integer(), nullable=True),
        sa.Column('job_type', sa.String(length=64), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='PENDING'),
        sa.Column('total_items', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('completed_items', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('failed_items', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('progress_message', sa.Text(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(['course_id'], ['courses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_processing_jobs_id'), 'processing_jobs', ['id'], unique=False)
    op.create_index(op.f('ix_processing_jobs_user_id'), 'processing_jobs', ['user_id'], unique=False)
    op.create_index(op.f('ix_processing_jobs_course_id'), 'processing_jobs', ['course_id'], unique=False)
    op.create_index(op.f('ix_processing_jobs_status'), 'processing_jobs', ['status'], unique=False)


def downgrade() -> None:
    op.drop_table('processing_jobs')
    op.drop_table('subtitles')
    op.drop_table('lectures')
    op.drop_table('sections')
    op.drop_table('courses')
    op.drop_table('udemy_sessions')
    op.drop_table('users')
