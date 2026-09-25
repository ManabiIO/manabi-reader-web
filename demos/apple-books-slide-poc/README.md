# Layered Manabi Slide demo

Demo-only work on `apple-books-slide-poc`. No production code, main-branch changes, or PR merges.

## Try it

Open `index.html` through an HTTPS static host. On iPhone swipe horizontally; on Mac use horizontal trackpad scrolling, mouse dragging, the wheel, or arrow keys. `Aa > Match screenshot` holds a backward Japanese turn at 58.5% and hides the controls. The ellipsis restores them. The half button exposes a signed progress slider and Cancel/Finish.

Forward: the current top sheet moves a full width while the next sheet shifts by 15% of a width and clears its shade. Backward: the previous sheet covers the current one, which shifts slightly and darkens. Titles and page numbers move with the sheets. The default maximum black shade is 24%; corners use an adjustable 55 CSS-pixel continuous-curve approximation. These are approximations from the reference image, not recovered Apple constants or a hardware-radius API.

## Actual Foliate integration

The demo incorporates the actual paginator from PR #49 at `8ced19eed90c9c26e88f56265857c867460d0b3c`, original paginator blob `3fef1b8e74d213585e208360f45583a1ad761593`. PR #47 was also inspected; #50 was consolidated into #49. MIT copyright and license for John Factotum's Foliate code are embedded in the application.

Three prepared iframe views and a hidden measuring view render original Japanese/English sample chapters using real reflow. There is no EPUB archive import in this demo. Horizontal gesture direction is independent of Foliate's internal scrollTop axis for vertical Japanese text. Actual native scroll displacement drives transforms, with ScrollTimeline and a matching scroll-offset fallback.

Neighbor preparation never commits reading progress. A completed turn promotes the prepared view. Production should use an engine-owned prepare/promote interface rather than four whole paginator instances, preserve Manabi ReaderLocator and FoliateCharacterProgress, rebind active-document consumers, and fence pending turns before search/TOC/restore navigation. Continuous/non-EPUB modes should remain unchanged.

Selection mode exposes the active iframe. Combining native dragging, text selection, links, annotations, and dictionary lookup still requires production gesture arbitration; the demo does not claim that is solved.

## Verification and packaging

50 Chromium checks passed against the exact standalone application, covering touch displacement/holding/reversal, mouse controls, both reading directions, chapter seams, reflow, stale asynchronous work, and motion fallbacks. This is not physical iPhone Safari or Mac trackpad qualification, and not a production Svelte end-to-end run.

The `layered-v2/part-*.txt` files are packaging only: concatenate in numeric order, decode base64, then gunzip to recover the exact self-contained HTML. The loader performs those steps and verifies SHA-256 `b8a2268d53e6ca5e94da4f16d739a8be790fcfb7de7800929fa5f091197a925e` before opening it. Every transferred part was checked against its Git blob hash before publishing. This is a temporary static preview, not a ChatGPT Sites deployment.

The attached source ZIP in the conversation includes readable source modules, the original pinned paginator, the demo-only engine patch, local server, tests, screenshots, and integration notes.
