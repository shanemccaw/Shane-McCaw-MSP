using System;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Imaging;
using MyArchitect.Models;
using MyArchitect.Services;
using WinFormsClipboard = System.Windows.Forms.Clipboard;
using UserControl = System.Windows.Controls.UserControl;

namespace MyArchitect.Controls;

public partial class ScreenshotGalleryPanel : UserControl
{
    private readonly IScreenshotEvidenceService _evidenceService;
    private readonly IEvidencePostClient _evidencePostClient;
    private readonly ObservableCollection<ScreenshotEvidenceItem> _items = new();
    private ScreenshotEvidenceItem? _selectedItem;

    public event EventHandler? CloseRequested;
    public event EventHandler? CaptureRequested;

    public ScreenshotGalleryPanel() : this(new EvidencePostClient())
    {
    }

    public ScreenshotGalleryPanel(IEvidencePostClient evidencePostClient)
    {
        InitializeComponent();
        _evidenceService = ScreenshotEvidenceService.Instance;
        _evidencePostClient = evidencePostClient;

        EvidenceListBox.ItemsSource = _items;

        _evidenceService.ItemAdded += (s, item) => Dispatcher.Invoke(() =>
        {
            _items.Insert(0, item);
            EvidenceListBox.SelectedItem = item;
            UpdateEmptyState();
        });

        _evidenceService.ItemUpdated += (s, item) => Dispatcher.Invoke(() =>
        {
            var idx = _items.IndexOf(_items.FirstOrDefault(i => i.Id == item.Id)!);
            if (idx >= 0)
            {
                _items[idx] = item;
                if (_selectedItem?.Id == item.Id)
                {
                    SelectEvidenceItem(item);
                }
            }
        });

        _evidenceService.ItemDeleted += (s, id) => Dispatcher.Invoke(() =>
        {
            var item = _items.FirstOrDefault(i => i.Id == id);
            if (item != null)
            {
                _items.Remove(item);
            }
            if (_selectedItem?.Id == id)
            {
                SelectEvidenceItem(_items.FirstOrDefault());
            }
            UpdateEmptyState();
        });

        Loaded += async (s, e) => await LoadEvidenceAsync();
    }

    public async Task LoadEvidenceAsync()
    {
        var list = await _evidenceService.GetAllAsync();
        _items.Clear();
        foreach (var item in list)
        {
            _items.Add(item);
        }

        UpdateEmptyState();
        if (_items.Count > 0)
        {
            EvidenceListBox.SelectedIndex = 0;
        }
    }

    private void UpdateEmptyState()
    {
        EmptyEvidenceOverlay.Visibility = _items.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        DetailContainer.Visibility = _items.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
        HeaderStatusTextBlock.Text = _items.Count > 0
            ? $"{_items.Count} Capture{(_items.Count == 1 ? "" : "s")}"
            : "No Captures";
    }

    private void EvidenceListBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (EvidenceListBox.SelectedItem is ScreenshotEvidenceItem item)
        {
            SelectEvidenceItem(item);
        }
        else if (_items.Count == 0)
        {
            SelectEvidenceItem(null);
        }
    }

    private void SelectEvidenceItem(ScreenshotEvidenceItem? item)
    {
        _selectedItem = item;
        if (item == null)
        {
            DetailContainer.Visibility = Visibility.Collapsed;
            PreviewImage.Source = null;
            return;
        }

        DetailContainer.Visibility = Visibility.Visible;
        DetailTenantTextBlock.Text = !string.IsNullOrWhiteSpace(item.TenantName) ? $"Tenant: {item.TenantName}" : "Tenant: Standby / System";
        DetailTimestampTextBlock.Text = $"Captured: {item.FormattedTime}";
        DetailResolutionTextBlock.Text = item.DisplayResolution;
        CaptionTextBox.Text = item.Caption ?? string.Empty;
        StepRefTextBox.Text = item.StepRef ?? string.Empty;
        ChangeRefTextBox.Text = item.ChangeRef ?? string.Empty;
        CustomerIdTextBox.Text = item.CustomerId?.ToString() ?? string.Empty;
        PostStatusTextBlock.Text = item.PostedAttachmentId != null
            ? $"Already posted — evidence attachment #{item.PostedAttachmentId}."
            : string.Empty;
        PostStatusTextBlock.Foreground = System.Windows.Media.Brushes.LimeGreen;

        // Load image non-locking
        if (!string.IsNullOrWhiteSpace(item.FilePath) && File.Exists(item.FilePath))
        {
            try
            {
                var bi = new BitmapImage();
                bi.BeginInit();
                bi.CacheOption = BitmapCacheOption.OnLoad;
                bi.UriSource = new Uri(item.FilePath, UriKind.Absolute);
                bi.EndInit();
                bi.Freeze();
                PreviewImage.Source = bi;
            }
            catch
            {
                PreviewImage.Source = null;
            }
        }
        else
        {
            PreviewImage.Source = null;
        }
    }

    private async void SaveCaptionButton_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedItem != null)
        {
            var newCaption = CaptionTextBox.Text?.Trim() ?? string.Empty;
            var newStep = StepRefTextBox.Text?.Trim() ?? string.Empty;
            var newChangeRef = ChangeRefTextBox.Text?.Trim() ?? string.Empty;
            int? customerId = int.TryParse(CustomerIdTextBox.Text?.Trim(), out var parsedCustomerId) ? parsedCustomerId : null;
            await _evidenceService.UpdateCaptionAsync(_selectedItem.Id, newCaption, newStep, newChangeRef, customerId);
        }
    }

    private async void PostEvidenceButton_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedItem == null)
        {
            return;
        }

        // Persist whatever's currently typed before posting, so the post uses the
        // latest caption/refs even if the operator didn't click "Save Caption" first.
        var caption = CaptionTextBox.Text?.Trim() ?? string.Empty;
        var stepRef = StepRefTextBox.Text?.Trim() ?? string.Empty;
        var changeRef = ChangeRefTextBox.Text?.Trim() ?? string.Empty;
        var customerIdText = CustomerIdTextBox.Text?.Trim() ?? string.Empty;
        int? customerId = int.TryParse(customerIdText, out var parsedCustomerId) ? parsedCustomerId : null;
        await _evidenceService.UpdateCaptionAsync(_selectedItem.Id, caption, stepRef, changeRef, customerId);
        _selectedItem.Caption = caption;
        _selectedItem.StepRef = stepRef;
        _selectedItem.ChangeRef = changeRef;
        _selectedItem.CustomerId = customerId;

        PostEvidenceButton.IsEnabled = false;
        PostStatusTextBlock.Foreground = System.Windows.Media.Brushes.Gray;
        PostStatusTextBlock.Text = "Posting…";

        try
        {
            EvidencePostResult result;
            if (!string.IsNullOrWhiteSpace(changeRef) && int.TryParse(changeRef, out var executionId))
            {
                result = await _evidencePostClient.PostChangeControlEvidenceAsync(executionId, _selectedItem);
            }
            else if (customerId != null && !string.IsNullOrWhiteSpace(stepRef))
            {
                result = await _evidencePostClient.PostRemediationStepEvidenceAsync(customerId.Value, stepRef, _selectedItem);
            }
            else
            {
                result = EvidencePostResult.Fail(
                    "Set a numeric Change Control Execution ID, or both a Customer ID and a Remediation Step ID, before posting.");
            }

            if (result.Success)
            {
                PostStatusTextBlock.Foreground = System.Windows.Media.Brushes.LimeGreen;
                PostStatusTextBlock.Text = result.AttachmentId is > 0
                    ? $"Posted — evidence attachment #{result.AttachmentId}."
                    : "Posted successfully.";
                if (result.AttachmentId is int id and > 0)
                {
                    await _evidenceService.MarkPostedAsync(_selectedItem.Id, id);
                }
            }
            else
            {
                PostStatusTextBlock.Foreground = System.Windows.Media.Brushes.OrangeRed;
                PostStatusTextBlock.Text = result.ErrorMessage ?? "Failed to post evidence.";
            }
        }
        finally
        {
            PostEvidenceButton.IsEnabled = true;
        }
    }

    private void CopyImageButton_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedItem != null && !string.IsNullOrWhiteSpace(_selectedItem.FilePath) && File.Exists(_selectedItem.FilePath))
        {
            try
            {
                using var bmp = new System.Drawing.Bitmap(_selectedItem.FilePath);
                var data = new System.Windows.Forms.DataObject();
                data.SetData(System.Windows.Forms.DataFormats.Bitmap, true, bmp);
                WinFormsClipboard.SetDataObject(data, true);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MyArchitect] Failed copying image to clipboard: {ex.Message}");
            }
        }
    }

    private void OpenExplorerButton_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedItem != null && !string.IsNullOrWhiteSpace(_selectedItem.FilePath) && File.Exists(_selectedItem.FilePath))
        {
            try
            {
                Process.Start("explorer.exe", $"/select,\"{_selectedItem.FilePath}\"");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MyArchitect] Explorer launch failed: {ex.Message}");
            }
        }
    }

    private async void DiscardButton_Click(object sender, RoutedEventArgs e)
    {
        if (_selectedItem != null)
        {
            var res = System.Windows.MessageBox.Show(
                "Are you sure you want to discard and delete this captured screenshot evidence?",
                "Confirm Discard",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);

            if (res == MessageBoxResult.Yes)
            {
                await _evidenceService.DeleteAsync(_selectedItem.Id, deleteLocalFile: true);
            }
        }
    }

    private void CaptureButton_Click(object sender, RoutedEventArgs e)
    {
        CaptureRequested?.Invoke(this, EventArgs.Empty);
    }

    private void ClosePanelButton_Click(object sender, RoutedEventArgs e)
    {
        CloseRequested?.Invoke(this, EventArgs.Empty);
    }
}
