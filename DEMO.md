# MeetIQ demo script

## Before you present (do this 30 min earlier)
1. Open the deployed site once so a free Render instance is awake.
2. Sign in as Faculty, upload a 2-3 min clip (include one quiet/mumbled sentence), click Process.
3. Run one search so the local embedding model is warmed up. Delete that session if you want a clean start.
4. Have a local copy running as a backup: `cd web && npm run dev`.

## Click path and what to say
1. **Problem.** "Tools like Otter and Mindgrasp generate notes but never tell you which parts might be wrong."
2. **Upload** the recording on the dashboard, click **Process**.
   "Every statement you are about to see was checked against this exact transcript. Anything that could not be verified was deleted, not shown with a disclaimer."
3. **Faculty review.** Point at a green **Verified** badge and an amber **Low-confidence** badge,
   then at the "% verified" bar and the segment tags (seg-3) that link each line to the transcript.
4. **Approval gate.** Open the student view before approving: it is empty.
   Go back, click **Approve & release to students**.
5. **Student.** Sign out, sign in as Student, open the session: only approved items show.
   Flip a flashcard, take the quiz.
6. **Search.** Ask a question. The result shows a timestamp and the cited segments.
7. **Close.** "Confidence travels from the recording all the way to a visible score on every generated item."

## If something goes wrong
- Processing failed page: check GROQ_API_KEY and the file (max 25 MB), delete the session, upload again.
- Data vanished: free Render instances lose data on restart. Re-upload.
