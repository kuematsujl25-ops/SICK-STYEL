// Synthetic diagnostic evidence only. No credentials or live CLI calls.
import {identityFromAuth} from '../../scripts/ai-staff/account-identity.js';
export const authIdentity=()=>({email:'operator@example.com',orgId:'11111111-1111-4111-8111-111111111111'});
export const applicability=()=>({version:2,identity:identityFromAuth(authIdentity()),executable:'/synthetic/.local/share/claude/versions/2.1.296',
  executable_sha256:'a'.repeat(64),cli_version:'2.1.296 (Claude Code)',
  credential:{loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'pro'},
  doctor_exit_code:0,doctor_remote_line:'Managed settings (remote): not fetched — requires an Enterprise or Team subscription',
  remote_policy:'not_applicable_to_current_credential',remote_cache:'absent',anthropic_profiles:'absent',credential_overrides:'absent'});
