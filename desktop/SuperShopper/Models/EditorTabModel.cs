using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class EditorTabModel : ObservableObject
    {
        private string _title = string.Empty;
        private string _filePath = string.Empty;
        private string _content = string.Empty;
        private string _language = "C#";
        private string _iconKey = "IconFileCode";
        private bool _isModified;
        private int _lineNumber = 1;
        private int _columnNumber = 1;

        public string Title
        {
            get => _title;
            set => SetField(ref _title, value);
        }

        public string FilePath
        {
            get => _filePath;
            set => SetField(ref _filePath, value);
        }

        public string Content
        {
            get => _content;
            set => SetField(ref _content, value);
        }

        public string Language
        {
            get => _language;
            set => SetField(ref _language, value);
        }

        public string IconKey
        {
            get => _iconKey;
            set => SetField(ref _iconKey, value);
        }

        public bool IsModified
        {
            get => _isModified;
            set => SetField(ref _isModified, value);
        }

        public int LineNumber
        {
            get => _lineNumber;
            set => SetField(ref _lineNumber, value);
        }

        public int ColumnNumber
        {
            get => _columnNumber;
            set => SetField(ref _columnNumber, value);
        }
    }
}
