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

        private string _statusText = "Synced"; // Synced, Failed, Scraping...
        private string _offerCount = "0 offers";
        private string _lastScrapeTime = "6:42 AM";
        private string _scrapeSpeed = "2.4 s";
        private string _pillColor = "#0084FF";
        private bool _isSelected;

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

        public string StatusText
        {
            get => _statusText;
            set => SetField(ref _statusText, value);
        }

        public string OfferCount
        {
            get => _offerCount;
            set => SetField(ref _offerCount, value);
        }

        public string LastScrapeTime
        {
            get => _lastScrapeTime;
            set => SetField(ref _lastScrapeTime, value);
        }

        public string ScrapeSpeed
        {
            get => _scrapeSpeed;
            set => SetField(ref _scrapeSpeed, value);
        }

        public string PillColor
        {
            get => _pillColor;
            set => SetField(ref _pillColor, value);
        }

        public bool IsSelected
        {
            get => _isSelected;
            set => SetField(ref _isSelected, value);
        }
    }
}
