import {Admin} from '../../../domain/admin';import type {AdminState} from '../../../domain/admin';
import type {CsAccountRepository} from '../../../application/cs-accounts';
import {withExecutor,type PgExecutor} from '../../../../../adapters-shared/pg-client';
function entity(r:Record<string,unknown>){return Admin.rehydrate({adminId:String(r.id),username:String(r.username),displayName:String(r.display_name),passwordHash:String(r.password_hash),role:r.role as AdminState['role'],status:r.status as AdminState['status'],lastLoginAt:r.last_login_at as Date|null,createdAt:r.created_at as Date,updatedAt:r.updated_at as Date});}
export class PostgresCsAccountRepository implements CsAccountRepository {
  constructor(private readonly pool:PgExecutor){}
  async save(a:Admin,tx:unknown){const s=a.state;await withExecutor(tx as PgExecutor,c=>c.query(`INSERT INTO admins(id,username,display_name,password_hash,role,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET status=EXCLUDED.status,updated_at=EXCLUDED.updated_at`,[s.adminId,s.username,s.displayName,s.passwordHash,s.role,s.status,s.createdAt,s.updatedAt]));}
  async findForUpdate(id:string,tx:unknown){return withExecutor(tx as PgExecutor,async c=>{const {rows}=await c.query('SELECT * FROM admins WHERE id=$1 FOR UPDATE',[id]);return rows[0]?entity(rows[0]):null;});}
  async revokeSessions(id:string,tx:unknown){await withExecutor(tx as PgExecutor,c=>c.query('UPDATE admin_sessions SET revoked_at=now() WHERE admin_id=$1 AND revoked_at IS NULL',[id]));}
  async list(){return withExecutor(this.pool,async c=>{const {rows}=await c.query("SELECT * FROM admins WHERE role IN ('cs_agent','cs_supervisor') ORDER BY display_name LIMIT 100");return rows.map(entity);});}
}
