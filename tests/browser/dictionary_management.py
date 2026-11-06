"""Black-box shared dictionary controls against a task-owned authored archive."""
from playwright.sync_api import expect


def exercise_dictionary_management(page, title, archive):
    setup = page.locator('details.setup')
    if setup.get_attribute('open') is None:
        setup.locator(':scope > summary').click()
    disable = page.get_by_role('button', name='Disable ' + title, exact=True)
    expect(disable).to_be_enabled()
    disable.click()
    enable = page.get_by_role('button', name='Enable ' + title, exact=True)
    expect(enable).to_be_enabled()
    enable.click()
    expect(disable).to_be_enabled()
    page.get_by_role('button', name='Delete ' + title, exact=True).click()
    page.get_by_role('button', name='Confirm delete ' + title, exact=True).click()
    expect(page.get_by_text('Deleted ' + title + '.', exact=True)).to_be_visible()
    expect(page.get_by_role('list', name='Installed local dictionaries', exact=True)).to_have_count(0)
    upload = page.get_by_label('Import dictionary ZIP', exact=True)
    expect(upload).to_be_enabled()
    upload.set_input_files(archive)
    expect(page.get_by_text('Installed ' + title + '.', exact=True)).to_be_visible(timeout=60000)
