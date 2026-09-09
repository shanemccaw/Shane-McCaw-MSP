using System.Collections.ObjectModel;
using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class FileItemModel : ObservableObject
    {
        private string _name = string.Empty;
        private string _path = string.Empty;
        private bool _isDirectory;
        private bool _isExpanded;
        private string _iconKey = "IconFileCode";
        private ObservableCollection<FileItemModel> _children = new();

        public string Name
        {
            get => _name;
            set => SetField(ref _name, value);
        }

        public string Path
        {
            get => _path;
            set => SetField(ref _path, value);
        }

        public bool IsDirectory
        {
            get => _isDirectory;
            set => SetField(ref _isDirectory, value);
        }

        public bool IsExpanded
        {
            get => _isExpanded;
            set => SetField(ref _isExpanded, value);
        }

        public string IconKey
        {
            get => _iconKey;
            set => SetField(ref _iconKey, value);
        }

        public ObservableCollection<FileItemModel> Children
        {
            get => _children;
            set => SetField(ref _children, value);
        }
    }
}
