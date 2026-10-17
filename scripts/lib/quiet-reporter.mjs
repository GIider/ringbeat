// node --test reporter that prints only failures and a one-line summary.
export default async function* quiet(source) {
  let pass = 0, fail = 0;
  for await (const { type, data } of source) {
    if (type === 'test:pass' && data.details.type !== 'suite') pass++;
    else if (type === 'test:fail' && data.details.type !== 'suite') {
      fail++;
      const e = data.details.error;
      yield `FAIL ${data.file ? data.file.split('/').pop() + ': ' : ''}${data.name}\n${(e.cause || e).stack || e.message}\n`;
    }
  }
  yield `unit tests: ${pass} passed, ${fail} failed\n`;
}
