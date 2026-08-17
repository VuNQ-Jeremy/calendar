import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createRawDb } from '../server/db/internal';
import { TenantDb, PRIMARY_TENANT_ID } from '../server/db/index';
import * as tuitionSvc from '../server/services/tuition';

/**
 * The bank details an admin records on /config.
 *
 * All that is left of what used to be a bigger suite around the student self-view: fees are
 * staff-only now, so nothing renders these to a family. They still have to survive a partial save,
 * because the /config form submits one section at a time.
 */
describe('tuition — payment info', () => {
  it('round-trips through the settings row', async () => {
    const d = new TenantDb(createRawDb(env), PRIMARY_TENANT_ID);
    expect((await tuitionSvc.getPaymentInfo(d)).bankCode).toBe(null);
    await tuitionSvc.setPaymentInfo(d, { bankCode: 'VCB', accountNumber: '123' });
    // A partial save must not blank the fields it did not mention.
    await tuitionSvc.setPaymentInfo(d, { accountHolder: 'NGUYEN VAN A' });
    expect(await tuitionSvc.getPaymentInfo(d)).toMatchObject({
      bankCode: 'VCB',
      accountNumber: '123',
      accountHolder: 'NGUYEN VAN A',
    });
  });
});
