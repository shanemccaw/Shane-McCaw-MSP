using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Media;

namespace BuildConsole.Models
{
    public class ObservableModelBase : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler? PropertyChanged;
        protected void OnPropertyChanged([CallerMemberName] string? propertyName = null)
        {
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
        }
    }

    public class ThemeModel
    {
        public List<ColorModel> Colors { get; set; } = new();
        public List<BrushModel> Brushes { get; set; } = new();
        public List<TypographyModel> Typography { get; set; } = new();
        public List<StyleModel> Styles { get; set; } = new();
        public List<TemplateModel> Templates { get; set; } = new();

        public DateTime LoadedTimestamp { get; set; } = DateTime.Now;
        public string SourceColorsPath { get; set; } = "";
        public string SourceTypographyPath { get; set; } = "";
        public string SourceDarkThemePath { get; set; } = "";
    }

    public class ColorModel : ObservableModelBase
    {
        private string _hexValue = "#000000";
        private Color _color = Colors.Black;
        private double _brightness;
        private double _contrastRatio;
        private bool _isTooBright;
        private bool _isLowContrast;
        private bool _isOutlier;
        private bool _isUnused;
        private int _usageCount;

        public string Key { get; set; } = "";
        public string SourceFile { get; set; } = "Colors.xaml";
        public string Category { get; set; } = "General"; // Background, Text, Accent, Status, General

        public string HexValue
        {
            get => _hexValue;
            set
            {
                if (_hexValue != value)
                {
                    _hexValue = value;
                    OnPropertyChanged();
                }
            }
        }

        public Color Color
        {
            get => _color;
            set
            {
                if (_color != value)
                {
                    _color = value;
                    OnPropertyChanged();
                }
            }
        }

        public double Brightness
        {
            get => _brightness;
            set
            {
                if (Math.Abs(_brightness - value) > 0.01)
                {
                    _brightness = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(BrightnessDisplay));
                }
            }
        }

        public string BrightnessDisplay => $"{Brightness:F0}/255";

        public double ContrastRatio
        {
            get => _contrastRatio;
            set
            {
                if (Math.Abs(_contrastRatio - value) > 0.01)
                {
                    _contrastRatio = value;
                    OnPropertyChanged();
                    OnPropertyChanged(nameof(ContrastDisplay));
                }
            }
        }

        public string ContrastDisplay => $"{ContrastRatio:F1}:1";

        public bool IsTooBright
        {
            get => _isTooBright;
            set { if (_isTooBright != value) { _isTooBright = value; OnPropertyChanged(); } }
        }

        public bool IsLowContrast
        {
            get => _isLowContrast;
            set { if (_isLowContrast != value) { _isLowContrast = value; OnPropertyChanged(); } }
        }

        public bool IsOutlier
        {
            get => _isOutlier;
            set { if (_isOutlier != value) { _isOutlier = value; OnPropertyChanged(); } }
        }

        public bool IsUnused
        {
            get => _isUnused;
            set { if (_isUnused != value) { _isUnused = value; OnPropertyChanged(); } }
        }

        public int UsageCount
        {
            get => _usageCount;
            set { if (_usageCount != value) { _usageCount = value; OnPropertyChanged(); } }
        }

        public List<string> ReferencedByBrushes { get; set; } = new();

        public bool HasDiagnostics => IsTooBright || IsLowContrast || IsOutlier || IsUnused;
    }

    public class BrushModel : ObservableModelBase
    {
        private string _colorHex = "#000000";
        private Brush? _brush;
        private double _opacity = 1.0;
        private int _usageCount;

        public string Key { get; set; } = "";
        public string? ColorKey { get; set; }
        public string SourceFile { get; set; } = "Colors.xaml"; // Colors.xaml or DarkTheme.xaml
        public string BrushType { get; set; } = "SolidColorBrush";

        public string ColorHex
        {
            get => _colorHex;
            set
            {
                if (_colorHex != value)
                {
                    _colorHex = value;
                    OnPropertyChanged();
                }
            }
        }

        public Brush? Brush
        {
            get => _brush;
            set
            {
                if (_brush != value)
                {
                    _brush = value;
                    OnPropertyChanged();
                }
            }
        }

        public double Opacity
        {
            get => _opacity;
            set
            {
                if (Math.Abs(_opacity - value) > 0.001)
                {
                    _opacity = value;
                    OnPropertyChanged();
                }
            }
        }

        public int UsageCount
        {
            get => _usageCount;
            set
            {
                if (_usageCount != value)
                {
                    _usageCount = value;
                    OnPropertyChanged();
                }
            }
        }

        public List<string> ReferencedByStyles { get; set; } = new();
        public List<string> ReferencedByTemplates { get; set; } = new();
    }

    public class TypographyModel : ObservableModelBase
    {
        private string _fontFamily = "Segoe UI";
        private double _fontSize = 14.0;
        private string _fontWeight = "Normal";
        private double _lineHeight = 1.2;
        private double _letterSpacing = 0.0;
        private string _sampleText = "The quick brown fox jumps over the lazy dog";

        public string Key { get; set; } = "";
        public string Category { get; set; } = "Body"; // Heading, Body, Caption, Button, Input, Size, Family
        public string SourceFile { get; set; } = "Typography.xaml";
        public string? TargetType { get; set; }

        public string FontFamily
        {
            get => _fontFamily;
            set { if (_fontFamily != value) { _fontFamily = value; OnPropertyChanged(); } }
        }

        public double FontSize
        {
            get => _fontSize;
            set { if (Math.Abs(_fontSize - value) > 0.1) { _fontSize = value; OnPropertyChanged(); } }
        }

        public string FontWeight
        {
            get => _fontWeight;
            set { if (_fontWeight != value) { _fontWeight = value; OnPropertyChanged(); } }
        }

        public double LineHeight
        {
            get => _lineHeight;
            set { if (Math.Abs(_lineHeight - value) > 0.01) { _lineHeight = value; OnPropertyChanged(); } }
        }

        public double LetterSpacing
        {
            get => _letterSpacing;
            set { if (Math.Abs(_letterSpacing - value) > 0.01) { _letterSpacing = value; OnPropertyChanged(); } }
        }

        public string SampleText
        {
            get => _sampleText;
            set { if (_sampleText != value) { _sampleText = value; OnPropertyChanged(); } }
        }

        public List<string> UsageLocations { get; set; } = new();
    }

    public class StyleModel
    {
        public string Key { get; set; } = "";
        public string TargetType { get; set; } = "";
        public string SourceFile { get; set; } = "DarkTheme.xaml";
        public string? BasedOn { get; set; }
        public List<string> BrushesUsed { get; set; } = new();
        public List<string> ColorsUsed { get; set; } = new();
        public List<string> TypographyUsed { get; set; } = new();
        public List<string> ControlReferences { get; set; } = new();
    }

    public class TemplateModel
    {
        public string Key { get; set; } = "";
        public string TargetType { get; set; } = "";
        public string SourceFile { get; set; } = "DarkTheme.xaml";
        public List<string> BrushesUsed { get; set; } = new();
        public List<string> ColorsUsed { get; set; } = new();
    }

    public class ThemeInspectionResult : ObservableModelBase
    {
        private string _elementHierarchy = "";
        private string _elementName = "";
        private string _inspectedProperty = "";
        private string _brushKey = "";
        private string _brushHex = "";
        private string _colorKey = "";
        private string _colorHex = "";
        private string _typographyKey = "";
        private string _styleKey = "";
        private string _templateKey = "";
        private string _sourceFile = "";
        private Brush? _previewBrush;

        public string ElementHierarchy
        {
            get => _elementHierarchy;
            set { if (_elementHierarchy != value) { _elementHierarchy = value; OnPropertyChanged(); } }
        }

        public string ElementName
        {
            get => _elementName;
            set { if (_elementName != value) { _elementName = value; OnPropertyChanged(); } }
        }

        public string InspectedProperty
        {
            get => _inspectedProperty;
            set { if (_inspectedProperty != value) { _inspectedProperty = value; OnPropertyChanged(); } }
        }

        public string BrushKey
        {
            get => _brushKey;
            set { if (_brushKey != value) { _brushKey = value; OnPropertyChanged(); } }
        }

        public string BrushHex
        {
            get => _brushHex;
            set { if (_brushHex != value) { _brushHex = value; OnPropertyChanged(); } }
        }

        public string ColorKey
        {
            get => _colorKey;
            set { if (_colorKey != value) { _colorKey = value; OnPropertyChanged(); } }
        }

        public string ColorHex
        {
            get => _colorHex;
            set { if (_colorHex != value) { _colorHex = value; OnPropertyChanged(); } }
        }

        public string TypographyKey
        {
            get => _typographyKey;
            set { if (_typographyKey != value) { _typographyKey = value; OnPropertyChanged(); } }
        }

        public string StyleKey
        {
            get => _styleKey;
            set { if (_styleKey != value) { _styleKey = value; OnPropertyChanged(); } }
        }

        public string TemplateKey
        {
            get => _templateKey;
            set { if (_templateKey != value) { _templateKey = value; OnPropertyChanged(); } }
        }

        public string SourceFile
        {
            get => _sourceFile;
            set { if (_sourceFile != value) { _sourceFile = value; OnPropertyChanged(); } }
        }

        public Brush? PreviewBrush
        {
            get => _previewBrush;
            set { if (_previewBrush != value) { _previewBrush = value; OnPropertyChanged(); } }
        }
    }
}
