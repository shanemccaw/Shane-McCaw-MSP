using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class StoreBookmarkModel : ObservableObject
    {
        private string _name = string.Empty;
        private string _url = string.Empty;
        private string _category = "Supermarket";
        private string _description = string.Empty;
        private string _iconKey = "IconExplorer";
        private bool _isFavorite;

        public string Name
        {
            get => _name;
            set => SetField(ref _name, value);
        }

        public string Url
        {
            get => _url;
            set => SetField(ref _url, value);
        }

        public string Category
        {
            get => _category;
            set => SetField(ref _category, value);
        }

        public string Description
        {
            get => _description;
            set => SetField(ref _description, value);
        }

        public string IconKey
        {
            get => _iconKey;
            set => SetField(ref _iconKey, value);
        }

        public bool IsFavorite
        {
            get => _isFavorite;
            set => SetField(ref _isFavorite, value);
        }
    }
}
