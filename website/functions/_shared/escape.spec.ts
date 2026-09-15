import { describe, expect, it } from 'vitest';
import { escapeHtml, serializeForScript } from './escape';

describe('escapeHtml', () => {
  it('escapes &, <, >, ", and \' characters correctly', () => {
    const raw = `"><svg onload='alert(1)'> & "test"`;
    const escaped = escapeHtml(raw);
    expect(escaped).toBe('&quot;&gt;&lt;svg onload=&#39;alert(1)&#39;&gt; &amp; &quot;test&quot;');
  });

  it('escapes & first so entities are not double-escaped', () => {
    const raw = '&amp; <tag>';
    const escaped = escapeHtml(raw);
    expect(escaped).toBe('&amp;amp; &lt;tag&gt;');
  });

  it('preserves non-markup characters, spaces, and non-Latin characters', () => {
    const raw = 'Stitch Wish 123 - Türkçe Şiir - 日本語';
    expect(escapeHtml(raw)).toBe(raw);
  });
});

describe('serializeForScript', () => {
  it('does not allow a double quote to terminate the JavaScript literal', () => {
    expect(serializeForScript('a"b')).toBe('"a\\"b"');
  });

  it('neutralises script closing and comment sequences', () => {
    expect(serializeForScript('</script><!--')).toBe('"\\u003C/script\\u003E\\u003C!--"');
  });

  it('escapes JavaScript line and paragraph separators', () => {
    const raw = 'line\u2028separator\u2029end';
    const serialized = serializeForScript(raw);

    expect(serialized).toContain('\\u2028');
    expect(serialized).toContain('\\u2029');
  });

  it('round-trips through JSON.parse', () => {
    const raw = 'a"b </script><!-- & line\u2028separator\u2029end';
    expect(JSON.parse(serializeForScript(raw))).toBe(raw);
  });
});
