using SuperShopper.ViewModels;

namespace SuperShopper.Models
{
    public class PersonalizedMatchModel : ObservableObject
    {
        private ExtractedDealModel _deal = new();
        private int _matchScore; // 0 - 100%
        private bool _isPantryRefillMatch;
        private bool _isPreferenceMatch;
        private string _matchReason = string.Empty;
        private string _matchBadgeText = "Match";

        public ExtractedDealModel Deal
        {
            get => _deal;
            set => SetField(ref _deal, value);
        }

        public int MatchScore
        {
            get => _matchScore;
            set => SetField(ref _matchScore, value);
        }

        public bool IsPantryRefillMatch
        {
            get => _isPantryRefillMatch;
            set => SetField(ref _isPantryRefillMatch, value);
        }

        public bool IsPreferenceMatch
        {
            get => _isPreferenceMatch;
            set => SetField(ref _isPreferenceMatch, value);
        }

        public string MatchReason
        {
            get => _matchReason;
            set => SetField(ref _matchReason, value);
        }

        public string MatchBadgeText
        {
            get => _matchBadgeText;
            set => SetField(ref _matchBadgeText, value);
        }
    }
}
