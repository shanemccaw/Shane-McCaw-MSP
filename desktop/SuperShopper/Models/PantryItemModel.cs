using System;
using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class PantryItemModel : ObservableObject
    {
        private string _itemName = string.Empty;
        private string _category = "General";
        private int _currentQuantity;
        private int _minQuantity = 1;
        private bool _needsRefill = true;
        private DateTime _lastPurchased = DateTime.Now.AddDays(-7);

        public string ItemName
        {
            get => _itemName;
            set => SetField(ref _itemName, value);
        }

        public string Category
        {
            get => _category;
            set => SetField(ref _category, value);
        }

        public int CurrentQuantity
        {
            get => _currentQuantity;
            set
            {
                if (SetField(ref _currentQuantity, value))
                {
                    NeedsRefill = _currentQuantity <= _minQuantity;
                }
            }
        }

        public int MinQuantity
        {
            get => _minQuantity;
            set
            {
                if (SetField(ref _minQuantity, value))
                {
                    NeedsRefill = _currentQuantity <= _minQuantity;
                }
            }
        }

        public bool NeedsRefill
        {
            get => _needsRefill;
            set => SetField(ref _needsRefill, value);
        }

        public DateTime LastPurchased
        {
            get => _lastPurchased;
            set => SetField(ref _lastPurchased, value);
        }
    }
}
