import { linkify } from './linkify';

describe('linkify', () => {
  it('transforma só links http/https e tira a pontuação do fim', () => {
    expect(linkify('veja https://pato.dev/a?b=1. ok')).toEqual([
      { kind: 'text', text: 'veja ' },
      { kind: 'link', text: 'https://pato.dev/a?b=1', href: 'https://pato.dev/a?b=1' },
      { kind: 'text', text: '. ok' },
    ]);
    expect(linkify('javascript:alert(1)')).toEqual([{ kind: 'text', text: 'javascript:alert(1)' }]);
    expect(linkify('<b>oi</b>')).toEqual([{ kind: 'text', text: '<b>oi</b>' }]);
  });
});
