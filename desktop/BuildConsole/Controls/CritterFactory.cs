using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Shapes;

namespace BuildConsole.Controls
{
    // A compact, parameter-driven factory set that composes playful vector critter canvases.
    // These intentionally use a different stylistic language than the existing "Gemini" critters:
    // - round blobs, soft gradients/bright pastels, simplified facial features, and tiny accessories.
    // - crafted to be visibly distinct but easy to animate with the existing motion primitives.
    public static class CritterFactory
    {
        private static Brush B(string hex) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));

        private static Canvas BaseBlob(double w, double h, Brush fill)
        {
            var c = new Canvas { Width = w, Height = h, ClipToBounds = false };
            var body = new Ellipse { Width = w, Height = h, Fill = fill };
            Canvas.SetLeft(body, 0); Canvas.SetTop(body, 0);
            c.Children.Add(body);
            return c;
        }

        private static void AddEye(Canvas c, double cx, double cy, double r)
        {
            var white = new Ellipse { Width = r * 2, Height = r * 2, Fill = Brushes.White };
            Canvas.SetLeft(white, cx - r); Canvas.SetTop(white, cy - r);
            var pupil = new Ellipse { Width = r * 0.6, Height = r * 0.6, Fill = Brushes.Black };
            Canvas.SetLeft(pupil, cx - r * 0.3); Canvas.SetTop(pupil, cy - r * 0.3);
            c.Children.Add(white);
            c.Children.Add(pupil);
        }

        private static void AddSmile(Canvas c, double cx, double cy, double w)
        {
            var path = new Path { Stroke = Brushes.Black, StrokeThickness = 1.2, Data = Geometry.Parse($"M {cx - w/2},{cy} C {cx - w/4},{cy + w/2} {cx + w/4},{cy + w/2} {cx + w/2},{cy}") };
            c.Children.Add(path);
        }

        // Negative critters
        public static Canvas CreateGrumpkin()
        {
            var c = BaseBlob(56, 46, B("#CDE0FF"));
            // brow
            var brow = new Rectangle { Width = 40, Height = 8, Fill = B("#9FB8DF"), RadiusX = 4, RadiusY = 4 };
            Canvas.SetLeft(brow, 8); Canvas.SetTop(brow, -2);
            c.Children.Add(brow);
            AddEye(c, 20, 20, 6);
            AddEye(c, 36, 20, 6);
            var mouth = new Path { Stroke = B("#2B3A67"), StrokeThickness = 1.2, Data = Geometry.Parse("M20,30 Q28,24 36,30") };
            c.Children.Add(mouth);
            return c;
        }

        public static Canvas CreatePoutlet()
        {
            var c = BaseBlob(48, 44, B("#FFE3E8"));
            AddEye(c, 18, 18, 5);
            AddEye(c, 30, 18, 5);
            var lip = new Ellipse { Width = 18, Height = 10, Fill = B("#FF9BB3") };
            Canvas.SetLeft(lip, 15); Canvas.SetTop(lip, 26);
            c.Children.Add(lip);
            var tear = new Ellipse { Width = 6, Height = 6, Fill = B("#CFE9FF") };
            Canvas.SetLeft(tear, 10); Canvas.SetTop(tear, 20);
            c.Children.Add(tear);
            return c;
        }

        public static Canvas CreateSnarlbug()
        {
            var c = BaseBlob(52, 40, B("#E8E6FF"));
            // little antenna
            var a = new Ellipse { Width = 6, Height = 6, Fill = B("#B7AFFF") };
            Canvas.SetLeft(a, 6); Canvas.SetTop(a, -4);
            c.Children.Add(a);
            AddEye(c, 18, 18, 5);
            AddEye(c, 34, 18, 5);
            var mouth = new Path { Stroke = B("#3A3870"), StrokeThickness = 1.2, Data = Geometry.Parse("M16,30 C22,24 30,24 36,30") };
            c.Children.Add(mouth);
            return c;
        }

        public static Canvas CreateMossmam()
        {
            var c = BaseBlob(64, 52, B("#DFF7E1"));
            // moss tuft
            var tuft = new Ellipse { Width = 22, Height = 12, Fill = B("#A8E6A0") };
            Canvas.SetLeft(tuft, 8); Canvas.SetTop(tuft, -6);
            c.Children.Add(tuft);
            AddEye(c, 22, 24, 6);
            AddEye(c, 42, 24, 6);
            var f = new Ellipse { Width = 12, Height = 8, Fill = B("#8FCF7B") };
            Canvas.SetLeft(f, 28); Canvas.SetTop(f, 34);
            c.Children.Add(f);
            return c;
        }

        public static Canvas CreateGlumfish()
        {
            var c = BaseBlob(60, 40, B("#DCEBFF"));
            // fin
            var fin = new Polygon { Points = new PointCollection { new Point(0,20), new Point(12,8), new Point(12,32) }, Fill = B("#9CC3FF") };
            c.Children.Add(fin);
            AddEye(c, 36, 18, 6);
            var mouth = new Path { Stroke = B("#2B3A67"), StrokeThickness = 1.2, Data = Geometry.Parse("M26,28 Q30,32 34,28") };
            c.Children.Add(mouth);
            return c;
        }

        // Positive critters — varied and cute
        public static Canvas CreateBlueberry()
        {
            var c = BaseBlob(54, 54, B("#9CCBEA"));
            var blush = new Ellipse { Width = 18, Height = 10, Fill = B("#CDEBFF") };
            Canvas.SetLeft(blush, 18); Canvas.SetTop(blush, 32);
            c.Children.Add(blush);
            AddEye(c, 20, 22, 5);
            AddEye(c, 34, 22, 5);
            var leaf = new Path { Fill = B("#66C27A"), Data = Geometry.Parse("M28,6 C22,2 18,10 28,12 C36,14 36,6 28,6") };
            c.Children.Add(leaf);
            return c;
        }

        public static Canvas CreateMoonmouse()
        {
            var c = BaseBlob(46, 42, B("#FFF5C7"));
            // ears
            var earL = new Ellipse { Width = 14, Height = 14, Fill = B("#FFD87A") };
            Canvas.SetLeft(earL, 2); Canvas.SetTop(earL, -4);
            var earR = new Ellipse { Width = 14, Height = 14, Fill = B("#FFD87A") };
            Canvas.SetLeft(earR, 30); Canvas.SetTop(earR, -4);
            c.Children.Add(earL); c.Children.Add(earR);
            AddEye(c, 18, 22, 5); AddEye(c, 30, 22, 5);
            AddSmile(c, 24, 30, 14);
            return c;
        }

        public static Canvas CreateStarlet()
        {
            var c = BaseBlob(48, 44, B("#F6D0FF"));
            AddEye(c, 16, 18, 5); AddEye(c, 32, 18, 5);
            var bow = new Ellipse { Width = 14, Height = 8, Fill = B("#FFD0ED") };
            Canvas.SetLeft(bow, 18); Canvas.SetTop(bow, -6);
            c.Children.Add(bow);
            return c;
        }

        public static Canvas CreateDaisy()
        {
            var c = BaseBlob(48, 48, B("#FFF8E1"));
            // petals
            for (int i = 0; i < 8; i++)
            {
                var petal = new Ellipse { Width = 14, Height = 8, Fill = B("#FFEFD6") };
                petal.RenderTransform = new RotateTransform(i * 45, 7, 4);
                Canvas.SetLeft(petal, 17); Canvas.SetTop(petal, -6);
                c.Children.Add(petal);
            }
            var center = new Ellipse { Width = 12, Height = 12, Fill = B("#FFD36B") };
            Canvas.SetLeft(center, 18); Canvas.SetTop(center, 16);
            c.Children.Add(center);
            AddEye(c, 20, 22, 4); AddEye(c, 28, 22, 4);
            return c;
        }

        public static Canvas CreateWhirlpix()
        {
            var c = BaseBlob(56, 50, B("#FFEACB"));
            var swirl = new Path { Stroke = B("#FFD09A"), StrokeThickness = 2, Data = Geometry.Parse("M10,30 C20,10 36,10 46,30") };
            c.Children.Add(swirl);
            AddEye(c, 20, 22, 5); AddEye(c, 36, 22, 5);
            return c;
        }

        public static Canvas CreateAurora()
        {
            var c = BaseBlob(60, 54, B("#EAD8FF"));
            var horn = new Polygon { Points = new PointCollection { new Point(30, -6), new Point(24, 22), new Point(36, 22) }, Fill = B("#FFD1FF") };
            c.Children.Add(horn);
            AddEye(c, 22, 26, 6); AddEye(c, 38, 26, 6);
            return c;
        }

        public static Canvas CreatePuffinette()
        {
            var c = BaseBlob(44, 40, B("#FFF0F0"));
            AddEye(c, 16, 18, 5); AddEye(c, 28, 18, 5);
            var tuft = new Ellipse { Width = 10, Height = 6, Fill = B("#FFD0D0") };
            Canvas.SetLeft(tuft, 18); Canvas.SetTop(tuft, -4);
            c.Children.Add(tuft);
            return c;
        }

        public static Canvas CreateSproutBunny()
        {
            var c = BaseBlob(50, 46, B("#E8FFE8"));
            var earL = new Rectangle { Width = 8, Height = 22, Fill = B("#D0FFDA"), RadiusX = 6, RadiusY = 6 };
            Canvas.SetLeft(earL, 6); Canvas.SetTop(earL, -6);
            var earR = new Rectangle { Width = 8, Height = 22, Fill = B("#D0FFDA"), RadiusX = 6, RadiusY = 6 };
            Canvas.SetLeft(earR, 36); Canvas.SetTop(earR, -6);
            c.Children.Add(earL); c.Children.Add(earR);
            AddEye(c, 20, 24, 5); AddEye(c, 30, 24, 5);
            return c;
        }

        public static Canvas CreateBuzzyBee()
        {
            var c = BaseBlob(44, 36, B("#FFF4D6"));
            var stripe = new Rectangle { Width = 40, Height = 10, Fill = B("#FFD45A"), RadiusX = 6, RadiusY = 6 };
            Canvas.SetLeft(stripe, 2); Canvas.SetTop(stripe, 12);
            c.Children.Add(stripe);
            AddEye(c, 16, 14, 4); AddEye(c, 28, 14, 4);
            var wing = new Ellipse { Width = 14, Height = 8, Fill = B("#E6F7FF"), Opacity = 0.9 };
            Canvas.SetLeft(wing, 28); Canvas.SetTop(wing, -4);
            c.Children.Add(wing);
            return c;
        }

        public static Canvas CreateGlimmerFox()
        {
            var c = BaseBlob(54, 44, B("#FFD9C2"));
            var tail = new Path { Fill = B("#FFC49A"), Data = Geometry.Parse("M44,20 C54,10 58,30 44,36") };
            c.Children.Add(tail);
            AddEye(c, 20, 20, 5); AddEye(c, 34, 20, 5);
            return c;
        }

        public static Canvas CreatePomPom()
        {
            var c = BaseBlob(40, 36, B("#FDE8FF"));
            var tail = new Ellipse { Width = 12, Height = 12, Fill = B("#FFD0FF") };
            Canvas.SetLeft(tail, 26); Canvas.SetTop(tail, 18);
            c.Children.Add(tail);
            AddEye(c, 14, 16, 4); AddEye(c, 26, 16, 4);
            return c;
        }

        public static Canvas CreateNibbles()
        {
            var c = BaseBlob(48, 40, B("#FFF2DF"));
            AddEye(c, 18, 18, 5); AddEye(c, 30, 18, 5);
            var acorn = new Ellipse { Width = 10, Height = 12, Fill = B("#D1A35A") };
            Canvas.SetLeft(acorn, 8); Canvas.SetTop(acorn, 24);
            c.Children.Add(acorn);
            return c;
        }

        public static Canvas CreateDragonet()
        {
            var c = BaseBlob(56, 44, B("#E8F0FF"));
            var wing = new Path { Fill = B("#CDE0FF"), Data = Geometry.Parse("M12,14 C20,6 36,6 44,14") };
            c.Children.Add(wing);
            AddEye(c, 22, 22, 6); AddEye(c, 36, 22, 6);
            return c;
        }

        public static Canvas CreateNimbus()
        {
            var c = BaseBlob(60, 44, B("#F0F8FF"));
            // cloud puffs
            for (int i = 0; i < 3; i++)
            {
                var p = new Ellipse { Width = 22, Height = 14, Fill = B("#FFFFFF"), Opacity = 0.95 };
                Canvas.SetLeft(p, 6 + i * 16);
                Canvas.SetTop(p, 8);
                c.Children.Add(p);
            }
            AddEye(c, 22, 28, 5); AddEye(c, 36, 28, 5);
            return c;
        }

        public static Canvas CreateSparkle()
        {
            var c = BaseBlob(60, 38, B("#EAF0FF"));
            var horn = new Polygon { Points = new PointCollection { new Point(30, -4), new Point(26,16), new Point(34,16) }, Fill = B("#FFD0FF") };
            c.Children.Add(horn);
            AddEye(c, 22, 20, 5); AddEye(c, 38, 20, 5);
            return c;
        }

        public static Canvas CreatePeony()
        {
            var c = BaseBlob(48, 42, B("#FFEAF2"));
            var scarf = new Rectangle { Width = 28, Height = 8, Fill = B("#FFC9E6"), RadiusX = 6, RadiusY = 6 };
            Canvas.SetLeft(scarf, 10); Canvas.SetTop(scarf, 26);
            c.Children.Add(scarf);
            AddEye(c, 18, 18, 5); AddEye(c, 30, 18, 5);
            return c;
        }

        public static Canvas CreateChirp()
        {
            var c = BaseBlob(38, 34, B("#FFF6D1"));
            AddEye(c, 14, 14, 4); AddEye(c, 24, 14, 4);
            var beak = new Polygon { Points = new PointCollection { new Point(22,18), new Point(28,16), new Point(22,22) }, Fill = B("#FFB04D") };
            c.Children.Add(beak);
            return c;
        }

        public static Canvas CreateMarigold()
        {
            var c = BaseBlob(46, 40, B("#FFF0E6"));
            var wing = new Ellipse { Width = 18, Height = 10, Fill = B("#FFE2A8") };
            Canvas.SetLeft(wing, 30); Canvas.SetTop(wing, 6);
            c.Children.Add(wing);
            AddEye(c, 18, 20, 5); AddEye(c, 30, 20, 5);
            return c;
        }

        public static Canvas CreateComet()
        {
            var c = BaseBlob(58, 44, B("#EAF8FF"));
            var tail = new Rectangle { Width = 28, Height = 8, Fill = B("#D0F0FF"), RadiusX = 6, RadiusY = 6 };
            Canvas.SetLeft(tail, -10); Canvas.SetTop(tail, 18);
            c.Children.Add(tail);
            AddEye(c, 28, 22, 6); AddEye(c, 40, 22, 6);
            return c;
        }

        public static Canvas CreateSunny()
        {
            var c = BaseBlob(48, 38, B("#FFF8D0"));
            var shell = new Ellipse { Width = 22, Height = 12, Fill = B("#FFDFA0") };
            Canvas.SetLeft(shell, 14); Canvas.SetTop(shell, 18);
            c.Children.Add(shell);
            AddEye(c, 16, 16, 4); AddEye(c, 30, 16, 4);
            return c;
        }
    }
}
