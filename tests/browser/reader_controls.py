"""Shared navigation helper for tests not specifically exercising reveal gestures."""
from playwright.sync_api import expect


def reveal_reader_controls(page):
    # Escape explicitly reveals/pins the chrome. Avoid racing the idle timer or
    # trying to click an invisible button. Pointer/touch behavior has its own tests.
    page.keyboard.press('Escape')
    controls = page.locator('button[data-reader-controls]')
    expect(controls).to_have_attribute('aria-expanded', 'true')
    toolbar = page.get_by_role('banner', name='Reader toolbar')
    expect(toolbar).to_be_visible()
    return toolbar
