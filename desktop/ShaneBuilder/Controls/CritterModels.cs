using System;
using System.Windows.Controls;

namespace ShaneBuilder;

public enum CritterCategory { Positive, Negative, Neutral }

public class CritterInfo
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public CritterCategory Category { get; set; }
    public double SpawnWeight { get; set; } = 1.0;
    public double Scale { get; set; } = 1.0;
    public Func<Canvas> Factory { get; set; } = () => new Canvas();
}
