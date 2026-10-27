import { describe, expect, it } from 'vitest';
import { contactsFromTable, parseCsv } from './contact-sheet';

describe('contactsFromTable', () => {
  it('finds Email, Name and Phone by header in any order and case', () => {
    const result = contactsFromTable([
      ['Sr', 'Phone Number', 'EMAIL', 'Full Name', 'City'],
      [1, 9876543210, ' Asha@Example.com ', 'Asha Rao', 'Pune'],
      [2, null, 'bad-email', 'Nope', ''],
      [3, '+44 7700 900123', 'asha@example.com', 'Asha R', ''],
      [4, '', 'ravi@x.io', '', ''],
      [null, null, null, null, null],
    ]);
    expect(result.columns).toEqual({ name: true, phone: true });
    expect(result.invalid).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.contacts).toEqual([
      { email: 'asha@example.com', name: 'Asha R', phone: '+44 7700 900123' },
      { email: 'ravi@x.io', name: null, phone: null },
    ]);
  });

  it('keeps a numeric phone number whole', () => {
    const [c] = contactsFromTable([['email', 'mobile'], ['a@b.co', 919876543210]]).contacts;
    expect(c?.phone).toBe('919876543210');
  });

  it('works without a header when one column is emails', () => {
    const result = contactsFromTable([
      ['Asha', 'asha@x.io'],
      ['Ravi', 'ravi@x.io'],
    ]);
    expect(result.contacts.map((c) => c.email)).toEqual(['asha@x.io', 'ravi@x.io']);
    expect(result.columns).toEqual({ name: false, phone: false });
  });
});

describe('parseCsv', () => {
  it('handles quotes, commas and newlines in fields', () => {
    expect(parseCsv('﻿name,email\r\n"Rao, Asha",a@x.io\n"Say ""hi""\nthere",b@x.io')).toEqual([
      ['name', 'email'],
      ['Rao, Asha', 'a@x.io'],
      ['Say "hi"\nthere', 'b@x.io'],
    ]);
  });
});
