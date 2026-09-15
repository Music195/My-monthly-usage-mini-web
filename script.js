/* ============================================================================
   SWEET HOME — BUDGET DASHBOARD
   ----------------------------------------------------------------------------
   This file is organized into clearly labeled sections so it reads top to
   bottom like a story:

     1. Configuration & global state
     2. Data fetching (talking to the Google Sheets backend)
     3. Data transformation (turning raw rows into dashboard-ready numbers)
     4. Local cache (instant load using localStorage)
     5. Dashboard bootstrapping & month switching
     6. Background sync (keeps data fresh without the user asking)
     7. Month picker UI (the custom dropdown in the header)
     8. Metrics slider (the "Current Balance / Savings / ..." carousel)
     9. Expense & income lists
    10. Transaction history page
    11. Page navigation (sidebar tabs, mobile menu)
    12. Receipt upload (drag & drop, camera, file picker)
    13. Startup (what actually kicks everything off)

   Nothing about *how* the app behaves has changed here — only the order of
   the code and the comments explaining *why* each part exists. If you're
   learning from this file, read the section headers first to get the shape
   of the app before diving into any one function.
   ========================================================================= */
