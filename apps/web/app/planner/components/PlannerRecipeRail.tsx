import type { ReactNode } from "react";

export type PlannerRecipeRailProps = {
  controls: ReactNode;
  recipes: ReactNode;
  footer: ReactNode;
};

export function PlannerRecipeRail({ controls, recipes, footer }: PlannerRecipeRailProps) {
  return (
    <aside className="planner-editorial__sidebar">
      <div className="planner-editorial__sidebar-head space-y-4">{controls}</div>
      <div className="planner-editorial__sidebar-scroll">{recipes}</div>
      <div className="planner-editorial__sidebar-foot">{footer}</div>
    </aside>
  );
}
