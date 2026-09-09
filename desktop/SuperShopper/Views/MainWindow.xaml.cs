using System;
using System.Windows;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using SuperShopper.ViewModels;

namespace SuperShopper.Views
{
    public partial class MainWindow : Window
    {
        public MainWindow()
        {
            InitializeComponent();
        }

        private async void Window_Loaded(object sender, RoutedEventArgs e)
        {
            try
            {
                await webView.EnsureCoreWebView2Async();
            }
            catch (Exception ex)
            {
                MessageBox.Show($"WebView2 initialization failed: {ex.Message}\nPlease ensure WebView2 Runtime is installed.", "SuperShopper Warning", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }

        private void TitleBar_MouseDown(object sender, MouseButtonEventArgs e)
        {
            if (e.ChangedButton == MouseButton.Left)
            {
                DragMove();
            }
        }

        private void WindowMinimize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState.Minimized;
        }

        private void WindowMaximize_Click(object sender, RoutedEventArgs e)
        {
            WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
        }

        private void WindowClose_Click(object sender, RoutedEventArgs e)
        {
            Close();
        }

        private void MenuExit_Click(object sender, RoutedEventArgs e)
        {
            Application.Current.Shutdown();
        }

        private void WebBack_Click(object sender, RoutedEventArgs e)
        {
            if (webView != null && webView.CanGoBack)
            {
                webView.GoBack();
            }
        }

        private void WebForward_Click(object sender, RoutedEventArgs e)
        {
            if (webView != null && webView.CanGoForward)
            {
                webView.GoForward();
            }
        }

        private void WebRefresh_Click(object sender, RoutedEventArgs e)
        {
            if (webView != null)
            {
                webView.Reload();
            }
        }

        private void AddressBar_KeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Enter)
            {
                if (DataContext is MainViewModel vm && vm.NavigateToUrlCommand.CanExecute(null))
                {
                    vm.NavigateToUrlCommand.Execute(null);
                }
            }
        }

        private void WebView_NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (DataContext is MainViewModel vm)
            {
                vm.IsLoading = true;
                vm.StatusMessage = "Loading weekly ad...";
            }
        }

        private void WebView_NavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (DataContext is MainViewModel vm)
            {
                vm.IsLoading = false;
                if (e.IsSuccess)
                {
                    vm.StatusMessage = "Page loaded successfully";
                    if (webView.Source != null)
                    {
                        vm.AddressBarInput = webView.Source.ToString();
                    }
                }
                else
                {
                    vm.StatusMessage = $"Navigation failed (Error code: {e.WebErrorStatus})";
                }
            }
        }
    }
}
