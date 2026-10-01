-- 0015 平台让利结算台账（T006 复验 A05，D006）
-- 组成功时记录整件售价快照与实际结算金额之差：diff = expected - settled（≥0 为平台让利；负值视为异常一并留痕）。
-- group_id 唯一：重复落账幂等跳过。
CREATE TABLE IF NOT EXISTS group_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE REFERENCES groups(id),
  expected_total_fen integer NOT NULL CHECK (expected_total_fen > 0),
  settled_total_fen integer NOT NULL CHECK (settled_total_fen >= 0),
  diff_fen integer NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE group_settlements IS 'D006 平台让利台账：组成功时 expected(整件售价快照)=settled(Σ已支付订单应付)+diff(让利)';
