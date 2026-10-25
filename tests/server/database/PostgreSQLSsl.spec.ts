import {expect} from 'chai';
import {postgresConnectionSsl} from '@/server/database/PostgreSQL';

describe('postgresConnectionSsl', () => {
  it('enables TLS for a Heroku-style URL', () => {
    expect(postgresConnectionSsl('postgres://user:pass@host/db')).deep.eq({rejectUnauthorized: false});
  });

  it('leaves TLS off when sslmode=disable', () => {
    expect(postgresConnectionSsl('postgresql://user:pass@postgres:5432/tfm?sslmode=disable')).eq(undefined);
  });

  it('leaves TLS off for a non-URL string', () => {
    expect(postgresConnectionSsl('host=localhost user=tfm')).eq(undefined);
  });
});
