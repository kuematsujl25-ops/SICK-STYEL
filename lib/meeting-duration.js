// Existing records without a duration keep the original 45 minute behavior.
export const validMeetingDuration=value=>Number.isInteger(value)&&value>=1&&value<=1440;
export function meetingDuration(org,kind){
 const value=org[kind+'MeetingDurationMin'];
 if(value===undefined)return 45;
 if(!validMeetingDuration(value))throw Error('所要時間は1〜1440分の整数で指定してください');
 return value;
}
