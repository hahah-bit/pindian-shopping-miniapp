import {ApplicationError,type Clock} from '../../../shared/kernel';
import {Admin,MIN_PASSWORD_LENGTH,MAX_PASSWORD_LENGTH} from '../domain/admin';
import type {PasswordHasher} from './ports';
export interface CsAccountRepository {save(admin:Admin,tx:unknown):Promise<void>;findForUpdate(id:string,tx:unknown):Promise<Admin|null>;revokeSessions(id:string,tx:unknown):Promise<void>;list():Promise<Admin[]>}
function summary(a:Admin){return {id:a.state.adminId,username:a.state.username,displayName:a.state.displayName,role:a.state.role,status:a.state.status};}
export class ManageCsAccounts {
  constructor(private readonly deps:{repository:CsAccountRepository;hasher:PasswordHasher;runner:{run<T>(fn:(tx:unknown)=>Promise<T>):Promise<T>};clock:Clock;audit:{execute(entry:Record<string,unknown>,tx:unknown):Promise<void>}}){}
  async list(){return (await this.deps.repository.list()).map(summary);}
  async create(input:{username:unknown;displayName:unknown;password:unknown;role:unknown;actorId:string}){
    if(!['cs_agent','cs_supervisor'].includes(String(input.role)))throw new ApplicationError('VALIDATION_FAILED','只能创建客服或客服主管');
    if(typeof input.password!=='string'||input.password.length<MIN_PASSWORD_LENGTH||input.password.length>MAX_PASSWORD_LENGTH)throw new ApplicationError('VALIDATION_FAILED','密码长度须为10–128位');
    const draft=Admin.create({username:typeof input.username==='string'?input.username:'',displayName:typeof input.displayName==='string'?input.displayName:'',passwordHash:await this.deps.hasher.hash(input.password),now:this.deps.clock.now()});
    const admin=Admin.rehydrate({...draft.state,role:input.role as 'cs_agent'|'cs_supervisor'});
    try{await this.deps.runner.run(async tx=>{await this.deps.repository.save(admin,tx);await this.deps.audit.execute({adminId:input.actorId,action:'cs.account_create',resourceType:'admin',resourceId:admin.state.adminId,requestId:null,detail:{role:admin.state.role}},tx);});}catch(e){if((e as {code?:string}).code==='23505')throw new ApplicationError('CONFLICT','用户名已存在');throw e;}
    return summary(admin);
  }
  async status(input:{id:string;status:unknown;actorId:string}){
    if(!['active','disabled'].includes(String(input.status)))throw new ApplicationError('VALIDATION_FAILED','账号状态非法');
    return this.deps.runner.run(async tx=>{const a=await this.deps.repository.findForUpdate(input.id,tx);if(!a||!['cs_agent','cs_supervisor'].includes(a.state.role))throw new ApplicationError('NOT_FOUND','客服账号不存在');
      const updated=input.status==='active'?a.activate(this.deps.clock.now()):a.disable(this.deps.clock.now());await this.deps.repository.save(updated,tx);if(input.status==='disabled')await this.deps.repository.revokeSessions(input.id,tx);
      await this.deps.audit.execute({adminId:input.actorId,action:'cs.account_status',resourceType:'admin',resourceId:input.id,requestId:null,detail:{status:input.status}},tx);return summary(updated);
    });
  }
}
