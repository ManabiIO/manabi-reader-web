"""Shared navigation helper for tests not specifically exercising reveal gestures."""
from playwright.sync_api import expect


def reveal_reader_controls(page):
    # Escape can reveal chrome from reading content. When focus already belongs
    # to the collapsed reveal button, activate that button explicitly instead.
    page.keyboard.press('Escape')
    # Let React commit Escape's reveal before deciding whether Enter is needed.
    page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    controls = page.locator('button[data-reader-controls]')
    if controls.get_attribute('aria-expanded') == 'false':
        controls.focus()
        page.keyboard.press('Enter')
    expect(controls).to_have_attribute('aria-expanded', 'true')
    toolbar = page.get_by_role('banner', name='Reader toolbar')
    expect(toolbar).to_be_visible()
    return toolbar
