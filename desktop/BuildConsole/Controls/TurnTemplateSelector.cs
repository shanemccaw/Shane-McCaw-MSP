using System.Windows;
using System.Windows.Controls;

namespace BuildConsole.Controls
{
    /// <summary>README: "Use an ItemsControl + DataTemplateSelector ... over Turns — one template per item type".</summary>
    public sealed class TurnTemplateSelector : DataTemplateSelector
    {
        public DataTemplate? UserMessageTemplate { get; set; }
        public DataTemplate? AssistantTurnStartTemplate { get; set; }
        public DataTemplate? AssistantParagraphTemplate { get; set; }
        public DataTemplate? ToolGroupTemplate { get; set; }
        public DataTemplate? StatusLineTemplate { get; set; }

        public override DataTemplate? SelectTemplate(object item, DependencyObject container) => item switch
        {
            UserMessageTurn => UserMessageTemplate,
            AssistantTurnStartTurn => AssistantTurnStartTemplate,
            AssistantParagraphTurn => AssistantParagraphTemplate,
            ToolGroupTurn => ToolGroupTemplate,
            StatusLineTurn => StatusLineTemplate,
            _ => null,
        };
    }
}
