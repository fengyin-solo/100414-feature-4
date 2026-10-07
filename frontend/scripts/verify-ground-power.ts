import { listEntries, runAction, updateGroundPower, resetModule } from '../src/api/local-service'
import { ACTORS } from '../src/stores/session'
import { GROUND_POWER_KEY, CREW_KEY } from '../src/data/ground-power-policy'

// 极简 localStorage 垫片
const mem: Record<string, string> = {}
;(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => (k in mem ? mem[k] : null),
    setItem: (k: string, v: string) => { mem[k] = v },
  },
}

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    failures++
    console.error(`FAIL: ${name} ${detail}`)
  } else {
    console.log(`PASS: ${name}`)
  }
}

const t1 = ACTORS.find((a) => a.id === 'maintenance-t1')!
const t2 = ACTORS.find((a) => a.id === 'maintenance-t2')!
const t3 = ACTORS.find((a) => a.id === 'maintenance-t3')!
const viewer = ACTORS.find((a) => a.id === 'ground-crew')!

// 1. 历史回填：种子缺归属，读取后应按管辖范围回填
const afterRead = listEntries(GROUND_POWER_KEY).items
const own1 = String(afterRead.find((r) => r.id === 1)!['归属航站楼'])
const own2 = String(afterRead.find((r) => r.id === 2)!['归属航站楼'])
const own3 = String(afterRead.find((r) => r.id === 3)!['归属航站楼'])
check('T1-101 机位设备回填 T1', own1 === 'T1', own1)
check('T2-203 机位设备回填 T2', own2 === 'T2', own2)
check('共享机位 TS-901 走兜底回填 T3（id=3 -> T3）', own3 === 'T3', own3)
check('受控旧值未被回填改动', String(afterRead.find((r) => r.id === 2)!['额定电流']) === '600A')

// 2. 其他单位越权提交直接拦截，且记录不变
const before = JSON.stringify(listEntries(GROUND_POWER_KEY).items.find((r) => r.id === 1))
const denied = updateGroundPower(1, { 输出电压: '999V' }, viewer)
const after = JSON.stringify(listEntries(GROUND_POWER_KEY).items.find((r) => r.id === 1))
check('其他单位越权提交被拦截', denied.ok === false && /越权/.test(denied.message), denied.message)
check('越权提交未改动任何旧值', before === after)

// 3. 他楼维护组也不能改
const cross = updateGroundPower(1, { 输出电压: '999V' }, t2)
check('T2维护组不能改T1设备', cross.ok === false && /越权/.test(cross.message), cross.message)

// 4. 本楼维护组可改
const ok = updateGroundPower(1, { 输出电压: '200V' }, t1)
check('T1维护组可改T1设备', ok.ok === true, ok.message)
check('电压已更新', String(listEntries(GROUND_POWER_KEY).items.find((r) => r.id === 1)!['输出电压']) === '200V')
check('归属字段未被编辑改动', String(listEntries(GROUND_POWER_KEY).items.find((r) => r.id === 1)!['归属航站楼']) === 'T1')

// 5. 重复提交只生效一次（值相同 -> 拦截）
const dup = updateGroundPower(1, { 输出电压: '200V' }, t1)
check('相同内容重复提交被幂等拦截', dup.ok === false && /重复提交/.test(dup.message), dup.message)

// 6. 不允许把设备挪到他楼机位
const move = updateGroundPower(1, { 所属机位: 'T2-299' }, t1)
check('改派到他楼机位被拦截', move.ok === false && /T2航站楼/.test(move.message), move.message)
// 同楼机位允许
const moveOk = updateGroundPower(1, { 所属机位: 'T1-108' }, t1)
check('同楼机位改派允许', moveOk.ok === true, moveOk.message)

// 7. 共享机位信息只读
const sharedEdit = updateGroundPower(3, { 所属机位: 'T3-301' }, t3)
check('共享机位所属机位只读被拦截', sharedEdit.ok === false && /共享机位/.test(sharedEdit.message), sharedEdit.message)
const sharedOther = updateGroundPower(3, { 输出电压: '12V' }, viewer)
check('共享机位设备其他单位仍只读', sharedOther.ok === false)

// 8. 设备编号重复
const conflict = updateGroundPower(1, { 设备编号: 'GROU-0002' }, t1)
check('设备编号重复被拦截', conflict.ok === false && /已存在/.test(conflict.message), conflict.message)

// 9. 确认断电 -> 同步释放地勤排班待办
const pendingBefore = listEntries(CREW_KEY).items.filter((r) => String(r['关联设备']) === 'GROU-0002' && r.pending).length
check('断电前有2条关联待办', pendingBefore === 2, String(pendingBefore))
const cut = runAction(GROUND_POWER_KEY, 2, '结束供电')
check('结束供电成功并回报释放条数', cut.ok === true && cut.releasedTodos === 2, JSON.stringify(cut))
const crewAfter = listEntries(CREW_KEY).items.filter((r) => String(r['关联设备']) === 'GROU-0002')
check('关联待办已释放（已离岗/pending=false）', crewAfter.every((r) => r.status === '已离岗' && r.pending === false))
check('不相关排班未受影响', String(listEntries(CREW_KEY).items.find((r) => r.id === 1)!.status) === '待排班')

// 10. 重复断电只生效一次，不会重复释放
const cutAgain = runAction(GROUND_POWER_KEY, 2, '结束供电')
check('重复结束供电被拦截', cutAgain.ok === false, cutAgain.message)

// 11. 幂等：回填后再读不重复改写，且再次重置模块仍能回填
resetModule(GROUND_POWER_KEY)
const resetRows = listEntries(GROUND_POWER_KEY).items
check('重置后仍自动回填归属', resetRows.every((r) => ['T1', 'T2', 'T3'].includes(String(r['归属航站楼']))))
resetModule(CREW_KEY)
const cut2 = runAction(GROUND_POWER_KEY, 2, '结束供电')
check('重置后断电仍释放2条', cut2.ok && cut2.releasedTodos === 2, JSON.stringify(cut2))

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`)
if (failures > 0) process.exit(1)
