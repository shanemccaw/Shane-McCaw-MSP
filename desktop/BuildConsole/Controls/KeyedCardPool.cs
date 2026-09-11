using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace BuildConsole.Controls
{
    /// <summary>
    /// Git #3698 — the identity-keyed form of <see cref="KeyedSlotCardHost"/>, for a card list that
    /// reorders, grows, shrinks and nests: BuildQueuePanel.RenderQueue's top-level cards plus the
    /// build-set containers holding cards of their own. One render is one pass:
    /// <see cref="BeginPass"/>, <see cref="Acquire{T}"/> for every element the render shows,
    /// <see cref="SyncChildren"/> to put them in place, then <see cref="EndPass"/>. An element whose
    /// id and key both match the last pass comes back as the same instance, so its running mascot
    /// animation keeps running instead of restarting, and only an element whose key changed is
    /// rebuilt. Every element a pass lets go of (key changed, or id gone) has each clock started
    /// through <see cref="KeyedSlotCardHost.BeginOwnedAnimation(UIElement, System.Windows.Media.Animation.IAnimatable, DependencyProperty, System.Windows.Media.Animation.AnimationTimeline)"/>
    /// anywhere in its subtree stopped, then is detached — the step the old <c>Children.Clear()</c>
    /// rebuild never took.
    ///
    /// WPF-only by design (no BuildConsole service types), so <c>scripts/probes/queue-card-leak</c>
    /// compiles this exact file to measure it.
    /// </summary>
    internal sealed class KeyedCardPool
    {
        private sealed class Entry
        {
            public Entry(object key, UIElement element, int pass) { Key = key; Element = element; Pass = pass; }
            public readonly object Key;
            public readonly UIElement Element;
            public int Pass;
        }

        private readonly Dictionary<object, Entry> _entries = new();
        private readonly List<UIElement> _released = new();
        private readonly HashSet<DependencyObject> _inUse = new();
        private int _pass;

        /// <summary>Elements the most recent pass built, reused and retired.</summary>
        public int Built { get; private set; }
        public int Reused { get; private set; }
        public int Retired { get; private set; }

        public void BeginPass()
        {
            _pass++;
            _inUse.Clear();
            Built = Reused = 0;
        }

        /// <summary>The element for <paramref name="id"/> this pass: last pass's instance when its key
        /// equals <paramref name="key"/>, otherwise a fresh one from <paramref name="build"/> (the
        /// replaced instance is retired at <see cref="EndPass"/>). If <paramref name="build"/> throws,
        /// nothing is recorded, and the old instance, no longer in use, is retired at EndPass.</summary>
        public T Acquire<T>(object id, object key, Func<T> build, out bool reused) where T : UIElement
        {
            // The same id twice in one pass gets its own slot instead of taking the element already
            // placed for the first.
            object slot = id;
            for (int n = 1; _entries.TryGetValue(slot, out var taken) && taken.Pass == _pass; n++)
                slot = (id, n);

            if (_entries.TryGetValue(slot, out var entry) && entry.Element is T same && Equals(entry.Key, key))
            {
                entry.Pass = _pass;
                _inUse.Add(same);
                Reused++;
                reused = true;
                return same;
            }

            var built = build();
            if (entry != null) _released.Add(entry.Element);
            _entries[slot] = new Entry(key, built, _pass);
            _inUse.Add(built);
            Built++;
            reused = false;
            return built;
        }

        /// <summary>Retires everything this pass didn't acquire. Call after <see cref="SyncChildren"/>
        /// has put the acquired elements where they belong, so none of them still sits inside a
        /// container that is being discarded.</summary>
        public void EndPass()
        {
            foreach (var stale in _entries.Where(kv => kv.Value.Pass != _pass).ToList())
            {
                _entries.Remove(stale.Key);
                _released.Add(stale.Value.Element);
            }
            Retired = _released.Count;
            foreach (var element in _released) Retire(element);
            _released.Clear();
            _inUse.Clear();
        }

        /// <summary>Stops and detaches every element this pool holds.</summary>
        public void RetireAll()
        {
            _inUse.Clear();
            foreach (var entry in _entries.Values) _released.Add(entry.Element);
            _entries.Clear();
            Retired = _released.Count;
            foreach (var element in _released) Retire(element);
            _released.Clear();
        }

        private void Retire(UIElement element)
        {
            KeyedSlotCardHost.StopOwnedAnimations(element, _inUse.Contains);
            Detach(element);
        }

        /// <summary>Makes <paramref name="panel"/>'s children exactly <paramref name="desired"/>, in order,
        /// moving as little as possible: a child already at its index stays put, one found elsewhere
        /// (later in this panel, or in another panel) is detached and inserted, and whatever is left
        /// over is removed from the end.</summary>
        public static void SyncChildren(Panel panel, IReadOnlyList<UIElement> desired)
        {
            var children = panel.Children;
            for (int i = 0; i < desired.Count; i++)
            {
                var want = desired[i];
                if (i < children.Count && ReferenceEquals(children[i], want)) continue;
                Detach(want);
                children.Insert(i, want);
            }
            while (children.Count > desired.Count) children.RemoveAt(children.Count - 1);
        }

        public static void Detach(UIElement element)
        {
            switch ((element as FrameworkElement)?.Parent ?? VisualTreeHelper.GetParent(element))
            {
                case Panel parent: parent.Children.Remove(element); break;
                case Decorator parent when ReferenceEquals(parent.Child, element): parent.Child = null; break;
                case ContentControl parent when ReferenceEquals(parent.Content, element): parent.Content = null; break;
            }
        }
    }
}
