using System;
using System.Diagnostics;
using System.IO;

namespace UdemySubtitleManager
{
    class Program
    {
        static void Main()
        {
            try
            {
                string dir = AppDomain.CurrentDomain.BaseDirectory;
                string batFile = Path.Combine(dir, "start_app.bat");

                if (File.Exists(batFile))
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = batFile;
                    psi.WorkingDirectory = dir;
                    psi.UseShellExecute = true; // Opens the launcher console window
                    Process.Start(psi);
                }
            }
            catch (Exception ex)
            {
                System.Windows.Forms.MessageBox.Show("Error starting Udemy Subtitle Manager: " + ex.Message, "Error");
            }
        }
    }
}
