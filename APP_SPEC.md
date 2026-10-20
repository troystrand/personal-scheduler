# Task Sequencer: Architecture & Cognitive System Specification

## 1. System Vision & Cognitive Philosophy
Task Sequencer is an **executive function prosthesis** designed for high-agency individuals navigating ADHD, time blindness, and temporal discounting. It bridges the gap between atomic actions and long-term fractal goals (health, craft, systemic operations).

### Cognitive Invariants
1. **Zero Attentional Overload (Decluttered by Default):**
   - The default view must emphasize capture and immediate orientation. 
   - Planning mechanics (Workbench, AI bundling prompts, date selectors) remain collapsed or partitioned until explicitly engaged.
2. **Externalized Sequencing:**
   - Eliminate blank-page paralysis. The system transforms unstructured thoughts, comma-separated lists, and voice transcripts into bounded, timed blocks.
3. **Frictionless Fidelity Auditing:**
   - Reflection and audits must have a micro-interaction budget (<3 seconds). 
   - Omission is valid signal: skipping a prompt is treated as a cognitive load data point, never an error or failure.
4. **Transition Bookends:**
   - Every execution block features pre-flight preparation (templates, reference cues) and post-flight debriefing to clear attentional residue.

---

## 2. Technical Architecture & Constraints

- **Client Runtime:** Pure vanilla ES6+, HTML5, CSS3. Zero frontend frameworks, zero build steps, zero client-side package bloat. Hosted statically via GitHub Pages.
- **Backend Edge Proxy:** Cloudflare Worker acting as an authenticated gatekeeper.
- **AI Processing:** Google Gemini API via edge proxy (for Hopper structuring, task sequencing, and Forge development collaboration).
- **Storage Hierarchy:**
  - *L1 (Client Active):* `localStorage` (Local-first, instant read/write, offline-resilient).
  - *L2 (Persistence & Multi-Device Sync):* Cloudflare D1 (Serverless SQLite at the edge, async background synchronization).
- **Date Standards:** Strict ISO-8601 local date strings (`YYYY-MM-DD`). Avoid client-locale timezone parsing bugs.

---

## 3. Universal Anchor Schema

All client updates in `index.html` MUST exist strictly within these established anchor boundaries:

```html
<!-- ANCHOR: CSS_THEME_AND_LAYOUT_START --> ... <!-- ANCHOR: CSS_THEME_AND_LAYOUT_END -->
<!-- ANCHOR: DOM_STRUCTURE_START -->        ... <!-- ANCHOR: DOM_STRUCTURE_END -->
<!-- ANCHOR: TASK_CARD_RENDER_START -->     ... <!-- ANCHOR: TASK_CARD_RENDER_END -->
<!-- ANCHOR: TASK_SORTING_LOGIC_START -->   ... <!-- ANCHOR: TASK_SORTING_LOGIC_END -->
<!-- ANCHOR: TASK_API_PARSING_AND_SAVE_START --> ... <!-- ANCHOR: TASK_API_PARSING_AND_SAVE_END -->
<!-- ANCHOR: FORGE_CHAT_CLIENT_START -->    ... <!-- ANCHOR: FORGE_CHAT_CLIENT_END -->
<!-- ANCHOR: VOICE_RECOGNITION_SETUP_START --> ... <!-- ANCHOR: VOICE_RECOGNITION_SETUP_END -->
