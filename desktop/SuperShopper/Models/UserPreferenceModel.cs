using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class UserPreferenceModel : ObservableObject
    {
        private string _keywordOrBrand = string.Empty;
        private string _preferenceLevel = "Favorite"; // "Must Have", "Favorite", "Like"
        private string _category = "General";

        public string KeywordOrBrand
        {
            get => _keywordOrBrand;
            set => SetField(ref _keywordOrBrand, value);
        }

        public string PreferenceLevel
        {
            get => _preferenceLevel;
            set => SetField(ref _preferenceLevel, value);
        }

        public string Category
        {
            get => _category;
            set => SetField(ref _category, value);
        }
    }
}
