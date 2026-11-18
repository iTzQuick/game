import { describe, expect, it } from 'vitest';
import { botClasses, botCount, botId, botName, isBotId } from '../src/combat/bots';

describe('Compagni guidati dal computer', () => {
  it('da soli due compagni, in due uno, in tre o più nessuno', () => {
    expect(botCount(1)).toBe(2);
    expect(botCount(2)).toBe(1);
    expect(botCount(3)).toBe(0);
    expect(botCount(4)).toBe(0);
  });

  it('prendono solo classi libere, prima chi protegge e chi cura', () => {
    expect(botClasses(['lama'], 2)).toEqual(['guardiano', 'custode']);
    expect(botClasses(['guardiano'], 2)).toEqual(['custode', 'lama']);
    expect(botClasses(['custode', 'guardiano'], 1)).toEqual(['lama']);
    expect(botClasses(['custode', 'guardiano', 'lama', 'tessitore'], 2)).toEqual([]);
  });

  it('si riconoscono dal nome e hanno un nome corto', () => {
    expect(isBotId(botId('custode'))).toBe(true);
    expect(isBotId('abc123')).toBe(false);
    expect(botName('custode')).toBe('Custode (IA)');
  });
});
