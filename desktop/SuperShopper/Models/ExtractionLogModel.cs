using System;

namespace SuperShopper.Models
{
    public class ExtractionLogModel
    {
        public string Timestamp { get; set; } = DateTime.Now.ToString("H:mm:ss");
        public string Message { get; set; } = string.Empty;
        public string LogLevel { get; set; } = "Info"; // Info, Success, Warning, Error
    }
}
