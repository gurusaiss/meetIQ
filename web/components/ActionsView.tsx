import type { ActionsAndDecisions } from "../../src/types.ts";
import { GroundingBadge } from "./GroundingBadge.tsx";
import { SrcChips } from "./SrcChips.tsx";

export function ActionsView({ actions }: { actions: ActionsAndDecisions }) {
  return (
    <>
      <div className="card">
        <strong style={{ fontSize: 16 }}>Decisions</strong>
        {actions.decisions.length === 0 ? (
          <p className="kpi" style={{ marginTop: 8 }}>No decisions were recorded.</p>
        ) : (
          actions.decisions.map((d, i) => (
            <div className={`point${d.flagged ? " flagged" : ""}`} key={i}>
              {d.text}
              <div style={{ marginTop: 6 }}>
                <GroundingBadge confidence={d.confidence} flagged={d.flagged} />
                <SrcChips refs={d.sourceRefs} />
              </div>
            </div>
          ))
        )}
      </div>
      <div className="card">
        <strong style={{ fontSize: 16 }}>Action items</strong>
        {actions.actionItems.length === 0 ? (
          <p className="kpi" style={{ marginTop: 8 }}>No action items were recorded.</p>
        ) : (
          actions.actionItems.map((a, i) => (
            <div className={`point${a.statement.flagged ? " flagged" : ""}`} key={i}>
              <div className="row" style={{ gap: 8 }}>
                <span>{a.statement.text}</span>
                <span className="chip">{a.owner ?? "Unassigned"}</span>
              </div>
              <div style={{ marginTop: 6 }}>
                <GroundingBadge confidence={a.statement.confidence} flagged={a.statement.flagged} />
                <SrcChips refs={a.statement.sourceRefs} />
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
