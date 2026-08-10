import { Flag, Target, Plus, Calendar, RefreshCw } from "lucide-react";
import { ACCENT } from "../../theme";
import { registerScreen } from "../../registry/registry";
import { getShellApi } from "../../shell/ShellContext";
import { ProjectManagementBody } from "./ProjectManagementBody";
import { syncFromGitHub } from "../build-tracker/buildTrackerStore";

import { BuildTrackerExplorer } from "../build-tracker/BuildTrackerExplorer";
import { BuildTrackerProperties } from "../build-tracker/BuildTrackerProperties";

export const ROUTE = "/project-management";

registerScreen({
  id: "project-management",
  title: "Project Management",
  area: "build",
  route: ROUTE,
  icon: Target,

  ribbon: [
    {
      tab: "build",
      group: {
        label: "Project",
        large: [
          {
            label: "Gantt & Milestones",
            icon: Target,
            intent: "open",
            color: ACCENT.amber,
            onSelect: () => getShellApi()?.navigate(ROUTE),
            title: "Open ADHD-friendly Project Gantt Chart & Milestone Timeline",
          },
        ],
      },
    },
  ],

  contextualTab: () => {
    return {
      id: "project-management-tools",
      label: "Roadmap Tools",
      groups: [
        {
          label: "Actions",
          large: [
            {
              label: "New Milestone",
              icon: Plus,
              intent: "record",
              color: ACCENT.amber,
              onSelect: () => {
                window.dispatchEvent(new CustomEvent("open-new-milestone-modal"));
              },
              title: "Create a new GitHub milestone",
            },
            {
              label: "Sync from GitHub",
              icon: RefreshCw,
              intent: "record",
              onSelect: () => void syncFromGitHub(),
              title: "Pull latest milestones and issues from GitHub",
            },
          ],
        },
        {
          label: "Navigation",
          small: [
            {
              label: "Build Tracker",
              icon: Flag,
              intent: "open",
              onSelect: () => getShellApi()?.navigate("/build-tracker"),
            },
          ],
        },
      ],
    };
  },

  render: () => <ProjectManagementBody />,

  left:  { title: "Milestones & Epics", render: () => <BuildTrackerExplorer /> },
  right: { title: "Properties",         render: () => <BuildTrackerProperties /> },
});
