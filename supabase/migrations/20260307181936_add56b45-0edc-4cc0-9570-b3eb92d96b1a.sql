
-- Create profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Create investigations table
CREATE TABLE public.investigations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled Investigation',
  description TEXT,
  graph_state JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.investigations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own investigations" ON public.investigations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can create investigations" ON public.investigations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own investigations" ON public.investigations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own investigations" ON public.investigations FOR DELETE USING (auth.uid() = user_id);

-- Create entities table
CREATE TABLE public.entities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  label TEXT NOT NULL,
  platform TEXT,
  metadata JSONB DEFAULT '{}',
  position_x DOUBLE PRECISION DEFAULT 0,
  position_y DOUBLE PRECISION DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view entities in their investigations" ON public.entities FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.investigations WHERE id = entities.investigation_id AND user_id = auth.uid()));
CREATE POLICY "Users can insert entities in their investigations" ON public.entities FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.investigations WHERE id = entities.investigation_id AND user_id = auth.uid()));
CREATE POLICY "Users can update entities in their investigations" ON public.entities FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.investigations WHERE id = entities.investigation_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete entities in their investigations" ON public.entities FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.investigations WHERE id = entities.investigation_id AND user_id = auth.uid()));

-- Create relationships table
CREATE TABLE public.relationships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  investigation_id UUID NOT NULL REFERENCES public.investigations(id) ON DELETE CASCADE,
  source_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  target_entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  label TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view relationships in their investigations" ON public.relationships FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.investigations WHERE id = relationships.investigation_id AND user_id = auth.uid()));
CREATE POLICY "Users can insert relationships in their investigations" ON public.relationships FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.investigations WHERE id = relationships.investigation_id AND user_id = auth.uid()));
CREATE POLICY "Users can update relationships in their investigations" ON public.relationships FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.investigations WHERE id = relationships.investigation_id AND user_id = auth.uid()));
CREATE POLICY "Users can delete relationships in their investigations" ON public.relationships FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.investigations WHERE id = relationships.investigation_id AND user_id = auth.uid()));

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_investigations_updated_at BEFORE UPDATE ON public.investigations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
