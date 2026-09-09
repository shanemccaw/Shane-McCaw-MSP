using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using SuperShopper.Models;

namespace SuperShopper.ViewModels
{
    public enum ActiveViewMode
    {
        Explorer,
        Search,
        SourceControl,
        Settings
    }

    public enum ActivePanelMode
    {
        Terminal,
        Output,
        Problems,
        Debug
    }

    public class MainViewModel : ObservableObject
    {
        private ActiveViewMode _activeView = ActiveViewMode.Explorer;
        private ActivePanelMode _activePanel = ActivePanelMode.Terminal;
        private bool _isSidebarOpen = true;
        private bool _isPanelOpen = true;

        private string _currentUrl = "https://www.publix.com/savings/weekly-ad/view-all";
        private string _addressBarInput = "https://www.publix.com/savings/weekly-ad/view-all";
        private string _activeStoreName = "Publix Super Markets";
        private bool _isLoading;
        private string _statusMessage = "Ready";

        private string _newItemTitle = string.Empty;
        private string _newBookmarkName = string.Empty;
        private string _newBookmarkUrl = string.Empty;

        private string _dealFilterQuery = string.Empty;
        private bool _isExtractingDeals;

        public ObservableCollection<StoreBookmarkModel> StoreBookmarks { get; } = new();
        public ObservableCollection<ShoppingItemModel> ShoppingList { get; } = new();
        public ObservableCollection<ExtractedDealModel> ExtractedDeals { get; } = new();
        public ObservableCollection<ExtractedDealModel> FilteredExtractedDeals { get; } = new();

        public ActiveViewMode ActiveView
        {
            get => _activeView;
            set
            {
                if (SetField(ref _activeView, value))
                {
                    OnPropertyChanged(nameof(IsExplorerActive));
                    OnPropertyChanged(nameof(IsSearchActive));
                    OnPropertyChanged(nameof(IsSourceControlActive));
                    OnPropertyChanged(nameof(IsSettingsActive));
                    OnPropertyChanged(nameof(SidebarHeaderTitle));
                }
            }
        }

        public ActivePanelMode ActivePanel
        {
            get => _activePanel;
            set
            {
                if (SetField(ref _activePanel, value))
                {
                    OnPropertyChanged(nameof(IsTerminalActive));
                    OnPropertyChanged(nameof(IsOutputActive));
                    OnPropertyChanged(nameof(IsProblemsActive));
                    OnPropertyChanged(nameof(IsDebugActive));
                }
            }
        }

        public bool IsSidebarOpen
        {
            get => _isSidebarOpen;
            set => SetField(ref _isSidebarOpen, value);
        }

        public bool IsPanelOpen
        {
            get => _isPanelOpen;
            set => SetField(ref _isPanelOpen, value);
        }

        public string CurrentUrl
        {
            get => _currentUrl;
            set
            {
                if (SetField(ref _currentUrl, value))
                {
                    AddressBarInput = value;
                    UpdateActiveStoreFromUrl(value);
                }
            }
        }

        public string AddressBarInput
        {
            get => _addressBarInput;
            set => SetField(ref _addressBarInput, value);
        }

        public string ActiveStoreName
        {
            get => _activeStoreName;
            set => SetField(ref _activeStoreName, value);
        }

        public bool IsLoading
        {
            get => _isLoading;
            set => SetField(ref _isLoading, value);
        }

        public string StatusMessage
        {
            get => _statusMessage;
            set => SetField(ref _statusMessage, value);
        }

        public string NewItemTitle
        {
            get => _newItemTitle;
            set => SetField(ref _newItemTitle, value);
        }

        public string NewBookmarkName
        {
            get => _newBookmarkName;
            set => SetField(ref _newBookmarkName, value);
        }

        public string NewBookmarkUrl
        {
            get => _newBookmarkUrl;
            set => SetField(ref _newBookmarkUrl, value);
        }

        public string DealFilterQuery
        {
            get => _dealFilterQuery;
            set
            {
                if (SetField(ref _dealFilterQuery, value))
                {
                    FilterDeals(value);
                }
            }
        }

        public bool IsExtractingDeals
        {
            get => _isExtractingDeals;
            set => SetField(ref _isExtractingDeals, value);
        }

        public int ExtractedDealsCount => ExtractedDeals.Count;

        public bool IsExplorerActive => ActiveView == ActiveViewMode.Explorer;
        public bool IsSearchActive => ActiveView == ActiveViewMode.Search;
        public bool IsSourceControlActive => ActiveView == ActiveViewMode.SourceControl;
        public bool IsSettingsActive => ActiveView == ActiveViewMode.Settings;

        public bool IsTerminalActive => ActivePanel == ActivePanelMode.Terminal;
        public bool IsOutputActive => ActivePanel == ActivePanelMode.Output;
        public bool IsProblemsActive => ActivePanel == ActivePanelMode.Problems;
        public bool IsDebugActive => ActivePanel == ActivePanelMode.Debug;

        public string SidebarHeaderTitle => ActiveView switch
        {
            ActiveViewMode.Explorer => "SUPERMARKETS & WEEKLY ADS",
            ActiveViewMode.Search => "SHOPPING LIST & SAVED DEALS",
            ActiveViewMode.SourceControl => "ADD NEW STORE BOOKMARK",
            ActiveViewMode.Settings => "PREFERENCES",
            _ => "SIDEBAR"
        };

        // Commands
        public ICommand SelectViewCommand { get; }
        public ICommand SelectPanelCommand { get; }
        public ICommand ToggleSidebarCommand { get; }
        public ICommand TogglePanelCommand { get; }

        public ICommand NavigateToUrlCommand { get; }
        public ICommand SelectStoreCommand { get; }
        public ICommand AddShoppingItemCommand { get; }
        public ICommand AddBookmarkCommand { get; }
        public ICommand OpenExternalBrowserCommand { get; }
        public ICommand AddDealToShoppingListCommand { get; }
        public ICommand ClearExtractedDealsCommand { get; }

        public MainViewModel()
        {
            SelectViewCommand = new RelayCommand(param =>
            {
                if (param is ActiveViewMode mode)
                {
                    if (ActiveView == mode && IsSidebarOpen)
                        IsSidebarOpen = false;
                    else
                    {
                        ActiveView = mode;
                        IsSidebarOpen = true;
                    }
                }
            });

            SelectPanelCommand = new RelayCommand(param =>
            {
                if (param is ActivePanelMode mode)
                {
                    ActivePanel = mode;
                    IsPanelOpen = true;
                }
            });

            ToggleSidebarCommand = new RelayCommand(_ => IsSidebarOpen = !IsSidebarOpen);
            TogglePanelCommand = new RelayCommand(_ => IsPanelOpen = !IsPanelOpen);

            NavigateToUrlCommand = new RelayCommand(param =>
            {
                var target = param as string ?? AddressBarInput;
                if (!string.IsNullOrWhiteSpace(target))
                {
                    if (!target.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                        !target.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
                    {
                        target = "https://" + target;
                    }
                    CurrentUrl = target;
                }
            });

            SelectStoreCommand = new RelayCommand(param =>
            {
                if (param is StoreBookmarkModel store)
                {
                    ActiveStoreName = store.Name;
                    CurrentUrl = store.Url;
                }
            });

            AddShoppingItemCommand = new RelayCommand(_ =>
            {
                if (!string.IsNullOrWhiteSpace(NewItemTitle))
                {
                    ShoppingList.Add(new ShoppingItemModel
                    {
                        Title = NewItemTitle.Trim(),
                        StoreName = ActiveStoreName,
                        PriceInfo = "Weekly Deal",
                        IsCompleted = false
                    });
                    NewItemTitle = string.Empty;
                    StatusMessage = "Item added to shopping list";
                }
            });

            AddBookmarkCommand = new RelayCommand(_ =>
            {
                if (!string.IsNullOrWhiteSpace(NewBookmarkName) && !string.IsNullOrWhiteSpace(NewBookmarkUrl))
                {
                    var url = NewBookmarkUrl.Trim();
                    if (!url.StartsWith("http://") && !url.StartsWith("https://")) url = "https://" + url;

                    StoreBookmarks.Add(new StoreBookmarkModel
                    {
                        Name = NewBookmarkName.Trim(),
                        Url = url,
                        Category = "Custom Store",
                        Description = "Custom weekly ad link",
                        IsFavorite = true
                    });
                    NewBookmarkName = string.Empty;
                    NewBookmarkUrl = string.Empty;
                    ActiveView = ActiveViewMode.Explorer;
                    StatusMessage = "New store bookmark added";
                }
            });

            OpenExternalBrowserCommand = new RelayCommand(_ =>
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = CurrentUrl,
                        UseShellExecute = true
                    });
                }
                catch (Exception ex)
                {
                    StatusMessage = $"Unable to open external browser: {ex.Message}";
                }
            });

            AddDealToShoppingListCommand = new RelayCommand(param =>
            {
                if (param is ExtractedDealModel deal)
                {
                    ShoppingList.Add(new ShoppingItemModel
                    {
                        Title = deal.Title,
                        StoreName = deal.StoreName,
                        PriceInfo = deal.DealType + " (" + deal.PriceInfo + ")",
                        IsCompleted = false
                    });
                    StatusMessage = $"Added '{deal.Title}' to shopping list!";
                }
            });

            ClearExtractedDealsCommand = new RelayCommand(_ =>
            {
                ExtractedDeals.Clear();
                FilteredExtractedDeals.Clear();
                OnPropertyChanged(nameof(ExtractedDealsCount));
                StatusMessage = "Cleared extracted deals";
            });

            InitializeStoreBookmarks();
            InitializeSampleShoppingList();
        }

        private void InitializeStoreBookmarks()
        {
            StoreBookmarks.Add(new StoreBookmarkModel
            {
                Name = "Publix Weekly Ad",
                Url = "https://www.publix.com/savings/weekly-ad/view-all",
                Category = "Supermarkets",
                Description = "View all weekly deals, BOGOs, and digital coupons",
                IsFavorite = true
            });

            StoreBookmarks.Add(new StoreBookmarkModel
            {
                Name = "Kroger Weekly Ad",
                Url = "https://www.kroger.com/weeklyad",
                Category = "Supermarkets",
                Description = "Digital coupons, weekly circular, and mega sale deals",
                IsFavorite = true
            });

            StoreBookmarks.Add(new StoreBookmarkModel
            {
                Name = "Walmart Savings Spotlight",
                Url = "https://www.walmart.com/savings-spotlight",
                Category = "Discount Superstores",
                Description = "Rollbacks, clearance, and weekly grocery savings",
                IsFavorite = true
            });

            StoreBookmarks.Add(new StoreBookmarkModel
            {
                Name = "Target Circle Offers",
                Url = "https://www.target.com/c/target-circle-offers/-/N-55119",
                Category = "Superstores",
                Description = "Weekly ad circular, Target Circle 20% off promos",
                IsFavorite = true
            });

            StoreBookmarks.Add(new StoreBookmarkModel
            {
                Name = "ALDI Weekly Ads",
                Url = "https://www.aldi.us/weekly-ads/",
                Category = "Discount Grocers",
                Description = "ALDI Finds of the week and fresh produce discounts",
                IsFavorite = true
            });

            StoreBookmarks.Add(new StoreBookmarkModel
            {
                Name = "Trader Joe's Stories",
                Url = "https://www.traderjoes.com/home/discover/stories",
                Category = "Specialty Grocers",
                Description = "New products, seasonal guides, and recipe deals",
                IsFavorite = false
            });

            StoreBookmarks.Add(new StoreBookmarkModel
            {
                Name = "Costco Warehouse Savings",
                Url = "https://www.costco.com/warehouse-locations",
                Category = "Wholesale Clubs",
                Description = "Member-only savings coupon book and warehouse deals",
                IsFavorite = false
            });
        }

        private void InitializeSampleShoppingList()
        {
            ShoppingList.Add(new ShoppingItemModel { Title = "Organic Strawberries (BOGO)", StoreName = "Publix Super Markets", PriceInfo = "Buy 1 Get 1 Free", IsCompleted = false });
            ShoppingList.Add(new ShoppingItemModel { Title = "Whole Milk (Gallon)", StoreName = "Kroger", PriceInfo = "$2.99", IsCompleted = false });
            ShoppingList.Add(new ShoppingItemModel { Title = "Avocados (Bag of 5)", StoreName = "ALDI", PriceInfo = "$1.99 / bag", IsCompleted = true });
        }

        public void AddExtractedDeal(ExtractedDealModel deal)
        {
            if (string.IsNullOrWhiteSpace(deal.Title) || deal.Title.Length < 3) return;

            var dispatcher = Application.Current?.Dispatcher;
            if (dispatcher != null && !dispatcher.CheckAccess())
            {
                dispatcher.InvokeAsync(() => AddExtractedDeal(deal));
                return;
            }

            // Standardize title and check duplicates
            string cleanTitle = deal.Title.Trim();
            if (!ExtractedDeals.Any(d => d.Title.Equals(cleanTitle, StringComparison.OrdinalIgnoreCase)))
            {
                deal.Title = cleanTitle;
                ExtractedDeals.Add(deal);
                FilterDeals(DealFilterQuery);
                OnPropertyChanged(nameof(ExtractedDealsCount));
            }
        }

        public void FilterDeals(string query)
        {
            var dispatcher = Application.Current?.Dispatcher;
            if (dispatcher != null && !dispatcher.CheckAccess())
            {
                dispatcher.InvokeAsync(() => FilterDeals(query));
                return;
            }

            FilteredExtractedDeals.Clear();
            var matches = string.IsNullOrWhiteSpace(query)
                ? ExtractedDeals
                : ExtractedDeals.Where(d => d.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                                            d.Category.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                                            d.DealType.Contains(query, StringComparison.OrdinalIgnoreCase));

            foreach (var item in matches)
            {
                FilteredExtractedDeals.Add(item);
            }
        }

        public void ProcessExtractedJson(string jsonString)
        {
            if (string.IsNullOrWhiteSpace(jsonString)) return;

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    using var doc = JsonDocument.Parse(jsonString);
                    var dealsList = new List<ExtractedDealModel>();

                    if (doc.RootElement.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var elem in doc.RootElement.EnumerateArray())
                        {
                            var deal = TryParseDirectDealObject(elem);
                            if (deal != null) dealsList.Add(deal);
                        }
                    }
                    else
                    {
                        TraverseJsonElement(doc.RootElement, dealsList);
                    }

                    foreach (var deal in dealsList)
                    {
                        AddExtractedDeal(deal);
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"JSON deal parse notice: {ex.Message}");
                }
            });
        }

        private ExtractedDealModel? TryParseDirectDealObject(JsonElement obj)
        {
            if (obj.ValueKind != JsonValueKind.Object) return null;

            string? title = GetStringProp(obj, "title", "name", "headline", "productName", "itemName");
            if (string.IsNullOrWhiteSpace(title) || title.Length < 3 || title.Length > 150) return null;

            string dealType = GetStringProp(obj, "dealType", "promotionType", "badge", "savingsText", "offerType") ?? "Weekly Sale";
            string price = GetStringProp(obj, "price", "savings", "priceInfo", "salePrice", "originalPrice") ?? "See Circular";
            string category = GetStringProp(obj, "category", "department", "departmentName") ?? "Groceries";
            string validDates = GetStringProp(obj, "validDates", "validity", "validFrom") ?? "Weekly Ad";

            if (title.Contains("BOGO", StringComparison.OrdinalIgnoreCase) || dealType.Contains("BOGO", StringComparison.OrdinalIgnoreCase))
            {
                dealType = "Buy 1 Get 1 Free";
            }

            return new ExtractedDealModel
            {
                Title = title.Trim(),
                DealType = dealType.Trim(),
                PriceInfo = price.Trim(),
                Category = category.Trim(),
                ValidDates = validDates.Trim(),
                StoreName = ActiveStoreName
            };
        }

        private void TraverseJsonElement(JsonElement elem, List<ExtractedDealModel> dealsList)
        {
            if (elem.ValueKind == JsonValueKind.Object)
            {
                var deal = TryParseDirectDealObject(elem);
                if (deal != null)
                {
                    dealsList.Add(deal);
                }

                foreach (var prop in elem.EnumerateObject())
                {
                    TraverseJsonElement(prop.Value, dealsList);
                }
            }
            else if (elem.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in elem.EnumerateArray())
                {
                    TraverseJsonElement(item, dealsList);
                }
            }
        }

        private string? GetStringProp(JsonElement elem, params string[] propNames)
        {
            foreach (var name in propNames)
            {
                if (elem.TryGetProperty(name, out var prop))
                {
                    if (prop.ValueKind == JsonValueKind.String)
                        return prop.GetString();
                    else if (prop.ValueKind == JsonValueKind.Number)
                        return prop.ToString();
                }
            }
            return null;
        }

        private void UpdateActiveStoreFromUrl(string url)
        {
            var match = StoreBookmarks.FirstOrDefault(b => url.StartsWith(b.Url, StringComparison.OrdinalIgnoreCase) || b.Url.StartsWith(url, StringComparison.OrdinalIgnoreCase));
            if (match != null)
            {
                ActiveStoreName = match.Name;
            }
            else
            {
                try
                {
                    var uri = new Uri(url);
                    ActiveStoreName = uri.Host.Replace("www.", "");
                }
                catch
                {
                    ActiveStoreName = "Web Store";
                }
            }
        }
    }
}
