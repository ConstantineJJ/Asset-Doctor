import type {Page} from '@playwright/test';
export async function openJointDetails(page:Page) {
  const details=page.getByTestId('rig-toolbar').locator('details');
  if(await details.getAttribute('open')===null)await details.locator('summary').click();
}
export async function closeJointDetails(page:Page) {
  const details=page.getByTestId('rig-toolbar').locator('details');
  if(await details.count()&&await details.getAttribute('open')!==null)await details.locator('summary').click();
}
