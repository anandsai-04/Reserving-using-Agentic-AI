from google import genai
import json

class ActuarialAgents:
    def __init__(self, api_key: str):
        self.client = genai.Client(api_key=api_key)
        self.model_name = "gemini-2.5-flash"

    def _call_llm(self, sys_instruction: str, prompt: str) -> str:
        import time
        models_to_try = [self.model_name, "gemini-2.0-flash", "gemini-1.5-flash"]
        last_error = ""
        
        for attempt in range(3):
            model = models_to_try[attempt % len(models_to_try)]
            try:
                response = self.client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=genai.types.GenerateContentConfig(
                        system_instruction=sys_instruction,
                        temperature=0.3
                    )
                )
                return response.text
            except Exception as e:
                last_error = str(e)
                if "429" in last_error or "503" in last_error:
                    time.sleep(2) # Wait and try again (possibly with fallback model)
                    continue
                break # Break immediately on 400 Bad Request or other fatal errors
                
        return f"Error connecting to Gemini after retries: {last_error}"

    def narrate_data_summary(self, summary_data: dict) -> str:
        sys_inst = "You are an expert Actuarial Data Summary Agent. Output ONLY HTML snippets (no markdown wrappers like ```html)."
        prompt = f"""
        Review this summary of an uploaded actuarial triangle.
        {json.dumps(summary_data, indent=2)}
        
        Write a concise 2-3 sentence summary explaining what was found. 
        Format important numbers with HTML <strong> tags.
        Do not write introductory text.
        """
        return self._call_llm(sys_inst, prompt)

    def narrate_analysis(self, recommendation_data: dict, summary_data: dict) -> str:
        sys_inst = "You are an expert Actuarial Analysis Agent. Output ONLY HTML snippets."
        prompt = f"""
        Data Summary: {json.dumps(summary_data, indent=2)}
        Model Recommendations: {json.dumps(recommendation_data, indent=2)}
        
        Write a concise 2-3 sentence narration explaining WHICH model is recommended and WHY, based on the dataset's characteristics.
        Format important terms with HTML <strong> tags.
        """
        return self._call_llm(sys_inst, prompt)

    def narrate_execution(self, exec_data: dict) -> str:
        sys_inst = "You are an expert Actuarial Execution Agent. Output ONLY HTML snippets."
        prompt = f"""
        Method run: {exec_data.get('method')}
        Total IBNR: {exec_data.get('totalIBNR')}
        Total Ultimate: {exec_data.get('totalUlt')}
        Total Paid: {exec_data.get('totalPaid')}
        Parameters used: {json.dumps(exec_data.get('params'))}
        
        Write a concise 2-3 sentence narration of the results. Mention the IBNR magnitude relative to Paid/Ultimate.
        Format important numbers with HTML <strong> tags.
        """
        return self._call_llm(sys_inst, prompt)

    def chat(self, message: str, history: list, context_data: dict) -> str:
        sys_inst = f"""
        You are an expert Actuarial Reserving Agent pair-programming with the user.
        You have access to the current state of their workspace:
        {json.dumps(context_data, indent=2)}
        
        Answer their questions concisely and directly. If they ask why IBNR is high/low, refer to the data.
        """
        
        # Build contents array
        contents = []
        for msg in history:
            role = 'user' if msg['role'] == 'user' else 'model'
            contents.append(genai.types.Content(role=role, parts=[genai.types.Part.from_text(msg['text'])]))
        contents.append(genai.types.Content(role='user', parts=[genai.types.Part.from_text(message)]))
        
        import time
        models_to_try = [self.model_name, "gemini-2.0-flash", "gemini-1.5-flash"]
        last_error = ""
        
        for attempt in range(3):
            model = models_to_try[attempt % len(models_to_try)]
            try:
                response = self.client.models.generate_content(
                    model=model,
                    contents=contents,
                    config=genai.types.GenerateContentConfig(
                        system_instruction=sys_inst,
                        temperature=0.5
                    )
                )
                return response.text
            except Exception as e:
                last_error = str(e)
                if "429" in last_error or "503" in last_error:
                    time.sleep(2)
                    continue
                break
                
        return f"Error after retries: {last_error}"
