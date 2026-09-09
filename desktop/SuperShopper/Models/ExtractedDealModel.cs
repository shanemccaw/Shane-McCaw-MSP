using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class ExtractedDealModel : ObservableObject
    {
        private string _title = string.Empty;
        private string _dealType = "Sale"; // e.g., "Buy 1 Get 1 Free", "Sale", "Digital Coupon"
        private string _priceInfo = string.Empty;
        private string _category = "General";
        private string _validDates = string.Empty;
        private string _imageUrl = string.Empty;
        private string _storeName = "Publix";
        private string _description = string.Empty;

        public string Title
        {
            get => _title;
            set => SetField(ref _title, value);
        }

        public string DealType
        {
            get => _dealType;
            set => SetField(ref _dealType, value);
        }

        public string PriceInfo
        {
            get => _priceInfo;
            set => SetField(ref _priceInfo, value);
        }

        public string Category
        {
            get => _category;
            set => SetField(ref _category, value);
        }

        public string ValidDates
        {
            get => _validDates;
            set => SetField(ref _validDates, value);
        }

        public string ImageUrl
        {
            get => _imageUrl;
            set => SetField(ref _imageUrl, value);
        }

        public string StoreName
        {
            get => _storeName;
            set => SetField(ref _storeName, value);
        }

        public string Description
        {
            get => _description;
            set => SetField(ref _description, value);
        }
    }
}
