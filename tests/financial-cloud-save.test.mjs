import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

// Exercita a fila real com rede e relógio controlados, sem criar contas Firebase.
const authSource = readFileSync(new URL("../mobile-auth.mjs", import.meta.url), "utf8");
const queueSource = authSource.slice(authSource.indexOf("  async function flushFinancialSave()"), authSource.indexOf("  async function activateUser("));
function harness(write) {
  const timers = new Map();
  const acknowledgements = [];
  const statuses = [];
  let timerId = 0;
  const queue = runInNewContext(`
    let currentUser = {uid:"account-a"};
    let saveTimer, pendingPayload, cloudWrite;
    let saveRetryDelay = 1500;
    const CLOUD_SAVE_DELAY_MS = 550;
    ${queueSource}
    ({ queueFinancialSave, flushFinancialSave,
      switchUser(uid) { currentUser = {uid}; pendingPayload = null; }
    });
  `, {
    writeFinancialData:write,
    cloneJson:value => structuredClone(value),
    setCloudStatus:(status) => statuses.push(status),
    onFinancialDataSaved:value => acknowledgements.push(value),
    setTimeout:(callback, delay) => { timers.set(++timerId, {callback, delay}); return timerId; },
    clearTimeout:id => timers.delete(id),
    console:{warn(){}},
  });
  return { ...queue, timers, acknowledgements, statuses };
}

test("falha na nuvem preserva a última edição e repete o envio automaticamente", async () => {
  const writes = [];
  let fail = true;
  const queue = harness(async payload => { writes.push(payload); if(fail) throw new Error("offline"); });
  queue.queueFinancialSave({value:100}, {immediate:true});
  await queue.flushFinancialSave();
  assert.equal(queue.acknowledgements.length, 0);
  const retry = [...queue.timers.values()][0];
  assert.equal(retry.delay, 1500);
  queue.queueFinancialSave({value:275.5});
  fail = false;
  [...queue.timers.values()][0].callback();
  await queue.flushFinancialSave();
  assert.deepEqual(writes, [{value:100}, {value:275.5}]);
  assert.equal(queue.acknowledgements[0].payload.value, 275.5);
  assert.equal(queue.timers.size, 0);
  assert.equal(queue.statuses.at(-1), "synced");
});

test("uma edição durante o envio aguarda e não é confirmada pela resposta anterior", async () => {
  const writes = [];
  let finishFirst;
  const queue = harness(async payload => {
    writes.push(payload);
    if(writes.length === 1) await new Promise(resolve => { finishFirst = resolve; });
  });
  queue.queueFinancialSave({value:100}, {immediate:true});
  queue.queueFinancialSave({value:275.5}, {immediate:true});
  assert.equal(writes.length, 1);
  assert.equal(queue.acknowledgements.length, 0);
  finishFirst();
  await queue.flushFinancialSave();
  assert.deepEqual(writes, [{value:100}, {value:275.5}]);
  assert.deepEqual(queue.acknowledgements.map(item => item.payload.value), [100, 275.5]);
});

test("uma falha antiga não mistura a fila de outra conta", async () => {
  const writes = [];
  let failFirst;
  const queue = harness(async (payload, uid) => {
    writes.push({payload, uid});
    if(writes.length === 1) await new Promise((_, reject) => { failFirst = reject; });
  });
  queue.queueFinancialSave({value:100}, {immediate:true});
  queue.switchUser("account-b");
  queue.queueFinancialSave({value:200}, {immediate:true});
  failFirst(new Error("offline"));
  await queue.flushFinancialSave();
  [...queue.timers.values()][0].callback();
  await queue.flushFinancialSave();
  assert.deepEqual(writes, [
    {payload:{value:100},uid:"account-a"},
    {payload:{value:200},uid:"account-b"},
  ]);
  assert.equal(queue.acknowledgements.length, 1);
  assert.equal(queue.acknowledgements[0].uid, "account-b");
});
