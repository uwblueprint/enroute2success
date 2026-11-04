export type CreateFeedbackInput = {
  receiver: number;
  session_id: string;
  text: string;
  giver: string;
};

export type UpdateFeedbackInput = {
  id: string;
  text: string;
  updated_by: string;
};
