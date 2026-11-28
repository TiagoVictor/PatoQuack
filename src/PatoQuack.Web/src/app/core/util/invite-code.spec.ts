import { parseInviteCode } from './invite-code';

describe('parseInviteCode', () => {
  it('aceita o código ou um link de convite', () => {
    expect(parseInviteCode(' ABCD2345 ')).toBe('abcd2345');
    expect(parseInviteCode('http://localhost:4200/convite/abcd2345')).toBe('abcd2345');
    expect(parseInviteCode('https://pato.app/convite/ABCD2345?x=1')).toBe('abcd2345');
    expect(parseInviteCode('http://localhost:4200/convite/k7m2pq9xabcd')).toBe('k7m2pq9xabcd');
  });

  it('rejeita o que não é código válido', () => {
    expect(parseInviteCode('')).toBeNull();
    expect(parseInviteCode('abc')).toBeNull();
    expect(parseInviteCode('abcd2340')).toBeNull(); // 0 não faz parte do alfabeto
    expect(parseInviteCode('abcd23456')).toBeNull(); // 9 caracteres
  });
});
