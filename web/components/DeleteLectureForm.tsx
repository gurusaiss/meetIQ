"use client";

export function DeleteLectureForm({ id }: { id: string }) {
  return (
    <form
      action={`/lectures/${encodeURIComponent(id)}/delete`}
      method="post"
      style={{ display: "inline" }}
      onSubmit={(e) => {
        if (!confirm(`Delete ${id} and all derived data?`)) e.preventDefault();
      }}
    >
      <button className="btn small ghost">Delete</button>
    </form>
  );
}
