const VALID_TRANSITIONS = {
  'pending_pay': ['paid', 'cancelled'],
  'paid': ['printing', 'cancelled'],
  'printing': ['completed', 'paid'],
  'completed': ['picked'],
  'picked': [],
  'cancelled': [],
};

function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

function transition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`无效的状态流转: ${from} → ${to}`);
  }
  return to;
}

function validateStatusChange(currentStatus, newStatus) {
  if (!canTransition(currentStatus, newStatus)) {
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    throw new Error(
      `状态流转不允许: 当前状态 "${currentStatus}" 不能变为 "${newStatus}"。` +
      (allowed.length ? `允许的目标: ${allowed.join(', ')}` : '当前为终态，不可变更')
    );
  }
  return true;
}

module.exports = { VALID_TRANSITIONS, canTransition, transition, validateStatusChange };
