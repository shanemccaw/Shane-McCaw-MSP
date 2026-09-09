using System;
using System.Collections.ObjectModel;
using System.Linq;
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
        private EditorTabModel? _activeTab;
        private string _searchQuery = string.Empty;
        private string _terminalInput = string.Empty;
        private string _terminalOutput = string.Empty;
        private string _statusBranch = "main*";
        private int _errorCount = 0;
        private int _warningCount = 0;

        public ObservableCollection<FileItemModel> FileTree { get; } = new();
        public ObservableCollection<EditorTabModel> Tabs { get; } = new();
        public ObservableCollection<string> SearchResults { get; } = new();

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

        public EditorTabModel? ActiveTab
        {
            get => _activeTab;
            set => SetField(ref _activeTab, value);
        }

        public string SearchQuery
        {
            get => _searchQuery;
            set
            {
                if (SetField(ref _searchQuery, value))
                {
                    PerformSearch(value);
                }
            }
        }

        public string TerminalInput
        {
            get => _terminalInput;
            set => SetField(ref _terminalInput, value);
        }

        public string TerminalOutput
        {
            get => _terminalOutput;
            set => SetField(ref _terminalOutput, value);
        }

        public string StatusBranch
        {
            get => _statusBranch;
            set => SetField(ref _statusBranch, value);
        }

        public int ErrorCount
        {
            get => _errorCount;
            set => SetField(ref _errorCount, value);
        }

        public int WarningCount
        {
            get => _warningCount;
            set => SetField(ref _warningCount, value);
        }

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
            ActiveViewMode.Explorer => "EXPLORER: SUPERSHOPPER",
            ActiveViewMode.Search => "SEARCH",
            ActiveViewMode.SourceControl => "SOURCE CONTROL",
            ActiveViewMode.Settings => "SETTINGS",
            _ => "SIDEBAR"
        };

        // Commands
        public ICommand SelectViewCommand { get; }
        public ICommand SelectPanelCommand { get; }
        public ICommand ToggleSidebarCommand { get; }
        public ICommand TogglePanelCommand { get; }
        public ICommand OpenFileCommand { get; }
        public ICommand CloseTabCommand { get; }
        public ICommand RunTerminalCommand { get; }
        public ICommand ClearTerminalCommand { get; }

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

            OpenFileCommand = new RelayCommand(param =>
            {
                if (param is FileItemModel file && !file.IsDirectory)
                {
                    OpenFileInTab(file);
                }
            });

            CloseTabCommand = new RelayCommand(param =>
            {
                if (param is EditorTabModel tab)
                {
                    CloseTab(tab);
                }
            });

            RunTerminalCommand = new RelayCommand(_ => ExecuteTerminalCommand());
            ClearTerminalCommand = new RelayCommand(_ => TerminalOutput = "PS C:\\Source\\SuperShopper> ");

            InitializeSampleWorkspace();
        }

        private void InitializeSampleWorkspace()
        {
            // Build File Tree
            var srcFolder = new FileItemModel
            {
                Name = "src",
                Path = "src",
                IsDirectory = true,
                IsExpanded = true,
                IconKey = "IconFolder"
            };

            var viewsFolder = new FileItemModel
            {
                Name = "Views",
                Path = "src/Views",
                IsDirectory = true,
                IsExpanded = true,
                IconKey = "IconFolder"
            };
            viewsFolder.Children.Add(new FileItemModel
            {
                Name = "MainWindow.xaml",
                Path = "src/Views/MainWindow.xaml",
                IsDirectory = false,
                IconKey = "IconFileCode"
            });
            viewsFolder.Children.Add(new FileItemModel
            {
                Name = "MainWindow.xaml.cs",
                Path = "src/Views/MainWindow.xaml.cs",
                IsDirectory = false,
                IconKey = "IconFileCode"
            });

            var vmFolder = new FileItemModel
            {
                Name = "ViewModels",
                Path = "src/ViewModels",
                IsDirectory = true,
                IsExpanded = true,
                IconKey = "IconFolder"
            };
            vmFolder.Children.Add(new FileItemModel
            {
                Name = "MainViewModel.cs",
                Path = "src/ViewModels/MainViewModel.cs",
                IsDirectory = false,
                IconKey = "IconFileCode"
            });

            var themesFolder = new FileItemModel
            {
                Name = "Themes",
                Path = "src/Themes",
                IsDirectory = true,
                IsExpanded = false,
                IconKey = "IconFolder"
            };
            themesFolder.Children.Add(new FileItemModel
            {
                Name = "DarkTheme.xaml",
                Path = "src/Themes/DarkTheme.xaml",
                IsDirectory = false,
                IconKey = "IconFileCode"
            });

            srcFolder.Children.Add(viewsFolder);
            srcFolder.Children.Add(vmFolder);
            srcFolder.Children.Add(themesFolder);

            FileTree.Add(srcFolder);
            FileTree.Add(new FileItemModel
            {
                Name = "SuperShopper.csproj",
                Path = "SuperShopper.csproj",
                IsDirectory = false,
                IconKey = "IconFileCode"
            });
            FileTree.Add(new FileItemModel
            {
                Name = "appsettings.json",
                Path = "appsettings.json",
                IsDirectory = false,
                IconKey = "IconFileJson"
            });

            // Default Open Tabs
            var defaultTab = new EditorTabModel
            {
                Title = "MainWindow.xaml",
                FilePath = "src/Views/MainWindow.xaml",
                Language = "XAML",
                IconKey = "IconFileCode",
                LineNumber = 14,
                ColumnNumber = 28,
                Content = @"<Window x:Class=""SuperShopper.MainWindow""
        xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation""
        xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml""
        Title=""SuperShopper IDE"" Height=""800"" Width=""1280""
        Background=""{StaticResource WindowBackgroundBrush}""
        WindowStyle=""None"" AllowsTransparency=""True"">
    
    <!-- Microsoft Dark Mode VS Code IDE Scaffolding -->
    <Grid>
        <!-- Activity Bar, Sidebar, Editor Tabs, Terminal & Status Bar -->
    </Grid>
</Window>"
            };

            var csTab = new EditorTabModel
            {
                Title = "MainViewModel.cs",
                FilePath = "src/ViewModels/MainViewModel.cs",
                Language = "C#",
                IconKey = "IconFileCode",
                LineNumber = 42,
                ColumnNumber = 12,
                Content = @"namespace SuperShopper.ViewModels
{
    public class MainViewModel : ObservableObject
    {
        // Microsoft Dark Mode IDE Scaffold ViewModel
        public MainViewModel()
        {
            InitializeSampleWorkspace();
        }
    }
}"
            };

            Tabs.Add(defaultTab);
            Tabs.Add(csTab);
            ActiveTab = defaultTab;

            // Initial Terminal Output
            TerminalOutput = "SuperShopper IDE Build Console [Version 1.0.0]\n" +
                             "(c) 2026 Antigravity IDE Engine. All rights reserved.\n\n" +
                             "PS C:\\Source\\SuperShopper> dotnet build --configuration Debug\n" +
                             "Build succeeded.\n" +
                             "    0 Warning(s)\n" +
                             "    0 Error(s)\n\n" +
                             "Time Elapsed 00:00:01.42\n" +
                             "PS C:\\Source\\SuperShopper> ";
        }

        private void OpenFileInTab(FileItemModel file)
        {
            var existing = Tabs.FirstOrDefault(t => t.FilePath == file.Path);
            if (existing != null)
            {
                ActiveTab = existing;
                return;
            }

            var newTab = new EditorTabModel
            {
                Title = file.Name,
                FilePath = file.Path,
                Language = file.Name.EndsWith(".cs") ? "C#" : (file.Name.EndsWith(".xaml") ? "XAML" : "JSON"),
                IconKey = file.IconKey,
                LineNumber = 1,
                ColumnNumber = 1,
                Content = $"// File contents for {file.Path}\n// Microsoft Dark Mode IDE View\n\nusing System;\n\nnamespace SuperShopper\n{{\n    public class {file.Name.Replace(".", "")}\n    {{\n        // Implementation details...\n    }}\n}}"
            };

            Tabs.Add(newTab);
            ActiveTab = newTab;
        }

        private void CloseTab(EditorTabModel tab)
        {
            Tabs.Remove(tab);
            if (ActiveTab == tab)
            {
                ActiveTab = Tabs.LastOrDefault();
            }
        }

        private void PerformSearch(string query)
        {
            SearchResults.Clear();
            if (string.IsNullOrWhiteSpace(query)) return;

            SearchResults.Add($"src/Views/MainWindow.xaml (Match: '{query}')");
            SearchResults.Add($"src/ViewModels/MainViewModel.cs (Match: '{query}')");
            SearchResults.Add($"Themes/DarkTheme.xaml (Match: '{query}')");
        }

        private void ExecuteTerminalCommand()
        {
            if (string.IsNullOrWhiteSpace(TerminalInput)) return;

            var cmd = TerminalInput.Trim();
            TerminalOutput += $"{cmd}\n";

            if (cmd.Equals("clear", StringComparison.OrdinalIgnoreCase) || cmd.Equals("cls", StringComparison.OrdinalIgnoreCase))
            {
                TerminalOutput = "PS C:\\Source\\SuperShopper> ";
            }
            else if (cmd.Equals("dotnet build", StringComparison.OrdinalIgnoreCase))
            {
                TerminalOutput += "Build started...\nBuild succeeded: 0 Errors, 0 Warnings.\nPS C:\\Source\\SuperShopper> ";
            }
            else
            {
                TerminalOutput += $"Executed command '{cmd}'. Status: OK.\nPS C:\\Source\\SuperShopper> ";
            }

            TerminalInput = string.Empty;
        }
    }
}
