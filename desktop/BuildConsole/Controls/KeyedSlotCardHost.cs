using System;
using System.Collections.Generic;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media.Animation;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #3689 — owns a fixed row of slot cards inside a <see cref="Panel"/> and updates it by
    /// diffing, not by clearing. Each card is paired with the key it was built from; on
    /// <see cref="Reconcile"/> a slot whose key is unchanged keeps its existing card untouched
    /// (so a running pulse keeps running rather than restarting), and only a slot whose key
    /// changed is rebuilt. Every card this host discards has the clocks started through
    /// <see cref="BeginOwnedAnimation"/> stopped first — a card thrown away mid-
    /// <c>RepeatBehavior.Forever</c> pulse otherwise leaves its clock ticking every frame until a
    /// GC happens to collect the card, which is how the Build Matrix drawer's old per-tick
    /// <c>Children.Clear()</c> rebuild piled up running clocks between collections.
    ///
    /// WPF-only by design (no BuildConsole service types), so
    /// <c>scripts/probes/matrix-pulse-leak</c> compiles this exact file to measure it.
    /// </summary>
    internal sealed class KeyedSlotCardHost
    {
        private readonly Panel _host;
        private readonly List<object> _keys = new();

        public KeyedSlotCardHost(Panel host) => _host = host;

        /// <summary>Makes the host show one card per key, in order. Returns how many cards were
        /// built this pass (0 when nothing displayed changed).</summary>
        public int Reconcile(IReadOnlyList<object> keys, Func<int, UIElement> buildCard)
        {
            // Something else rewrote the host's children — the pairing can't be trusted.
            if (_host.Children.Count != _keys.Count) Retire();

            int built = 0;
            for (int i = 0; i < keys.Count; i++)
            {
                if (i < _keys.Count)
                {
                    if (Equals(_keys[i], keys[i])) continue;
                    StopAnimations(_host.Children[i]);
                    // Remove + Insert: UIElementCollection's indexer setter throws while the old
                    // card is still connected at that index.
                    _host.Children.RemoveAt(i);
                    _host.Children.Insert(i, buildCard(i));
                    _keys[i] = keys[i];
                }
                else
                {
                    _host.Children.Add(buildCard(i));
                    _keys.Add(keys[i]);
                }
                built++;
            }

            while (_keys.Count > keys.Count)
            {
                int last = _keys.Count - 1;
                StopAnimations(_host.Children[last]);
                _host.Children.RemoveAt(last);
                _keys.RemoveAt(last);
            }
            return built;
        }

        /// <summary>Stops every card's animation and empties the host.</summary>
        public void Retire()
        {
            foreach (UIElement card in _host.Children) StopAnimations(card);
            _host.Children.Clear();
            _keys.Clear();
        }

        /// <summary>
        /// Starts <paramref name="animation"/> on a card through a clock this host can really stop
        /// when it discards the card. Use this, not <c>BeginAnimation</c>, for any animation on a
        /// card this host owns. Measured with the #3689 probe (400 Forever pulses per phase):
        /// <c>BeginAnimation(dp, null)</c> only unhooks the element — the clock itself keeps ticking
        /// every frame until a GC happens to collect it — while <c>Controller.Stop()</c> ends it at once.
        /// </summary>
        public static void BeginOwnedAnimation(UIElement card, DependencyProperty property, AnimationTimeline animation)
        {
            var clock = animation.CreateClock();
            card.ApplyAnimationClock(property, clock);
            if (card.GetValue(OwnedClocksProperty) is not List<OwnedClock> owned)
                card.SetValue(OwnedClocksProperty, owned = new List<OwnedClock>());
            owned.Add(new OwnedClock(property, clock));
        }

        private static void StopAnimations(UIElement card)
        {
            if (card.GetValue(OwnedClocksProperty) is not List<OwnedClock> owned) return;
            foreach (var (property, clock) in owned)
            {
                clock.Controller?.Stop();
                card.ApplyAnimationClock(property, null);
            }
            owned.Clear();
        }

        private sealed record OwnedClock(DependencyProperty Property, AnimationClock Clock);

        private static readonly DependencyProperty OwnedClocksProperty = DependencyProperty.RegisterAttached(
            "OwnedClocks", typeof(List<OwnedClock>), typeof(KeyedSlotCardHost));
    }
}
