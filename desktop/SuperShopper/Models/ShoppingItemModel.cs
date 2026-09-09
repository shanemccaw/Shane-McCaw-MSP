using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class ShoppingItemModel : ObservableObject
    {
        private string _title = string.Empty;
        private string _storeName = string.Empty;
        private string _priceInfo = string.Empty;
        private bool _isCompleted;

        public string Title
        {
            get => _title;
            set => SetField(ref _title, value);
        }

        public string StoreName
        {
            get => _storeName;
            set => SetField(ref _storeName, value);
        }

        public string PriceInfo
        {
            get => _priceInfo;
            set => SetField(ref _priceInfo, value);
        }

        public bool IsCompleted
        {
            get => _isCompleted;
            set => SetField(ref _isCompleted, value);
        }
    }
}
